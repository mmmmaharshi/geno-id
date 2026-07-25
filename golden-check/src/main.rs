use std::collections::HashMap;
use std::fs;
use std::path::Path;

// === Deterministic PRNG (xorshift128+, matches TypeScript createSeededRandom) ===
struct Xorshift128p {
    s0: u32,
    s1: u32,
}

impl Xorshift128p {
    fn new(s0: u32, s1: u32) -> Self {
        Self { s0, s1 }
    }
    fn next_u32(&mut self) -> u32 {
        let mut t = self.s1;
        t ^= t << 23;
        t ^= t >> 17;
        t ^= self.s0;
        t ^= self.s0 >> 26;
        self.s0 = self.s1;
        self.s1 = t;
        self.s1
    }
    fn fill_bytes(&mut self, buf: &mut [u8]) {
        let mut off = 0;
        while off < buf.len() {
            let val = self.next_u32();
            let n = (buf.len() - off).min(4);
            for i in 0..n {
                buf[off + i] = ((val >> (i * 8)) & 0xff) as u8;
            }
            off += n;
        }
    }
}

// === csprngInt-alike: separate buffer refilled from PRNG in 256-byte chunks ===
struct CsprngStream<'a> {
    rng: &'a mut Xorshift128p,
    buf: [u8; 256],
    pos: usize,
}

impl<'a> CsprngStream<'a> {
    fn new(rng: &'a mut Xorshift128p) -> Self {
        let mut buf = [0u8; 256];
        rng.fill_bytes(&mut buf);
        Self { rng, buf, pos: 0 }
    }
    fn next_byte(&mut self) -> u8 {
        if self.pos >= 256 {
            self.rng.fill_bytes(&mut self.buf);
            self.pos = 0;
        }
        let b = self.buf[self.pos];
        self.pos += 1;
        b
    }
}

// === drawValue (matches TypeScript drawValue) ===
fn draw_value(csprng: &mut CsprngStream, mod_val: u64) -> u64 {
    if mod_val <= 256 {
        return (csprng.next_byte() as u64) % mod_val;
    }
    let mut need: u32 = 1;
    while (1u64 << (need * 8)) < mod_val {
        need += 1;
    }
    let mut v: u64 = 0;
    for _ in 0..need {
        v = v * 256 + (csprng.next_byte() as u64);
    }
    v % mod_val
}

// === pickFrom (matches TypeScript pickFrom) ===
fn pick_from(csprng: &mut CsprngStream, allowed: &[u32]) -> u32 {
    let n = allowed.len();
    if n == 1 {
        return allowed[0];
    }
    let limit = 256 - (256 % n as u32);
    let mut x = csprng.next_byte() as u32;
    while x >= limit {
        x = csprng.next_byte() as u32;
    }
    allowed[(x % n as u32) as usize]
}

// === Layout ===
#[derive(Clone, Debug)]
enum FieldType {
    TimestampMs,
    Counter,
    Shard,
    Node,
}

#[derive(Clone, Debug)]
struct Constraint {
    allowed: Option<Vec<u32>>,
    monotonic: bool,
}

#[derive(Clone, Debug)]
struct Field {
    name: String,
    start: u32,
    length: u32,
    ftype: FieldType,
    constraint: Option<Constraint>,
}

// === Bit helpers ===
fn write_bits(buf: &mut [u8; 16], start: u32, len: u32, value: u64) {
    for i in 0..len {
        let pos = start + i;
        let byte_idx = (pos >> 3) as usize;
        let bit_idx = 7 - (pos & 7);
        let bit = ((value >> (len - 1 - i)) & 1) as u8;
        buf[byte_idx] = (buf[byte_idx] & !(1 << bit_idx)) | (bit << bit_idx);
    }
}

fn read_bits(buf: &[u8; 16], start: u32, len: u32) -> u64 {
    let mut v: u64 = 0;
    for i in 0..len {
        let pos = start + i;
        let byte_idx = (pos >> 3) as usize;
        let bit_idx = 7 - (pos & 7);
        let bit = (buf[byte_idx] >> bit_idx) & 1;
        v = (v << 1) | bit as u64;
    }
    v
}

fn hamming(a: u64, b: u64, bits: u32) -> u32 {
    let mut d = 0;
    for i in 0..bits {
        if ((a >> i) ^ (b >> i)) & 1 != 0 {
            d += 1;
        }
    }
    d
}

fn force_version_variant(buf: &mut [u8; 16]) {
    buf[6] = (buf[6] & 0x0f) | 0x80;
    buf[8] = (buf[8] & 0x3f) | 0x80;
}

fn to_uuid_string(buf: &[u8; 16]) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        buf[0], buf[1], buf[2], buf[3],
        buf[4], buf[5],
        buf[6], buf[7],
        buf[8], buf[9],
        buf[10], buf[11], buf[12], buf[13], buf[14], buf[15],
    )
}

// === Repair (matches TypeScript repairConstraints) ===
fn repair_constraints(
    buf: &mut [u8; 16],
    fields: &[Field],
    monotonic: &mut HashMap<String, u64>,
    layout_name: &str,
) {
    for f in fields {
        let c = match &f.constraint {
            Some(c) => c,
            None => continue,
        };
        let raw = read_bits(buf, f.start, f.length);
        let mut v = raw;
        let mut changed = false;
        if let Some(allowed) = &c.allowed {
            let allowed_u64: Vec<u64> = allowed.iter().map(|&a| a as u64).collect();
            if !allowed_u64.contains(&v) {
                let (mut best, mut best_d) = (allowed_u64[0], u32::MAX);
                for &a in &allowed_u64 {
                    let d = hamming(v, a, f.length);
                    if d < best_d { best_d = d; best = a; }
                }
                v = best;
                changed = true;
            }
        }
        if c.monotonic {
            let key = format!("{}:{}", layout_name, f.name);
            let last = *monotonic.get(&key).unwrap_or(&0);
            if v < last { v = last; changed = true; }
            monotonic.insert(key, v);
        }
        if changed { write_bits(buf, f.start, f.length, v); }
    }
}

// === Layout definitions ===
const TIMESTAMP_MS: u64 = 1_700_000_000_000;

// Replicating the TypeScript refillSingleParentPool pattern exactly:
// 1. fillRandom(pool) for 34*1024 bytes
// 2. Then for each entry, apply structured fields
// 3. Shard/Node fields use the csprngInt byte stream

fn generate_batch(
    rng: &mut Xorshift128p,
    fields: &[Field],
    layout_name: &str,
    monotonic: &mut HashMap<String, u64>,
    counters: &mut HashMap<String, u64>,
    count: usize,
) -> Vec<String> {
    const STRUCT_ENTRY: usize = 34;
    const POOL_SIZE: usize = 1024;
    let pool_bytes = STRUCT_ENTRY * POOL_SIZE;

    let mut pool = vec![0u8; pool_bytes];
    rng.fill_bytes(&mut pool);
    let mut csprng = CsprngStream::new(rng);

    let mut strings = Vec::with_capacity(POOL_SIZE);
    for n in 0..POOL_SIZE {
        let off = n * STRUCT_ENTRY;
        let mut buf = [0u8; 16];
        buf.copy_from_slice(&pool[off..off + 16]);

        for f in fields {
            let mod_val = if f.length < 64 { 1u64 << f.length } else { 0 };
            let val = match f.ftype {
                FieldType::TimestampMs => {
                    let m = if f.length < 64 { 1u64 << f.length } else { 0 };
                    if m > 0 { TIMESTAMP_MS % m } else { TIMESTAMP_MS }
                }
                FieldType::Counter => {
                    let key = format!("{}:{}", layout_name, f.name);
                    let cur = counters.get(&key).copied().unwrap_or(0) + 1;
                    counters.insert(key, cur);
                    let m = if f.length < 64 { 1u64 << f.length } else { 0 };
                    if m > 0 { cur % m } else { cur }
                }
                FieldType::Shard => {
                    if let Some(c) = &f.constraint {
                        if let Some(allowed) = &c.allowed {
                            // pickFrom path: 1 byte rejection sampling
                            (pick_from(&mut csprng, allowed) as u64) % mod_val
                        } else {
                            draw_value(&mut csprng, mod_val)
                        }
                    } else {
                        draw_value(&mut csprng, mod_val)
                    }
                }
                FieldType::Node => {
                    draw_value(&mut csprng, mod_val)
                }
            };
            write_bits(&mut buf, f.start, f.length, val);
        }
        force_version_variant(&mut buf);
        repair_constraints(&mut buf, fields, monotonic, layout_name);
        strings.push(to_uuid_string(&buf));
    }
    strings.truncate(count);
    strings
}

// === Layout definitions ===
fn dbkey_layout() -> Vec<Field> {
    vec![
        Field { name: "timestamp".into(), start: 0, length: 48, ftype: FieldType::TimestampMs, constraint: None },
        Field { name: "shard".into(), start: 52, length: 8, ftype: FieldType::Shard,
            constraint: Some(Constraint { allowed: Some(vec![1, 2, 3, 4, 5]), monotonic: false }) },
        Field { name: "counter".into(), start: 66, length: 16, ftype: FieldType::Counter,
            constraint: Some(Constraint { allowed: None, monotonic: true }) },
    ]
}

fn multitenant_layout() -> Vec<Field> {
    vec![
        Field { name: "tenant".into(), start: 0, length: 12, ftype: FieldType::Shard,
            constraint: Some(Constraint { allowed: Some(vec![1, 2, 3, 4, 5, 6, 7, 8]), monotonic: false }) },
        Field { name: "region".into(), start: 52, length: 8, ftype: FieldType::Shard,
            constraint: Some(Constraint { allowed: Some(vec![1, 2, 3, 4]), monotonic: false }) },
    ]
}

fn eventsourcing_layout() -> Vec<Field> {
    vec![
        Field { name: "stream".into(), start: 0, length: 16, ftype: FieldType::Node, constraint: None },
        Field { name: "seq".into(), start: 66, length: 24, ftype: FieldType::Counter,
            constraint: Some(Constraint { allowed: None, monotonic: true }) },
    ]
}

const SEED0: u32 = 0xdeadbeef;
const SEED1: u32 = 0x4f15f00d;
const N: usize = 1000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let golden_dir = manifest_dir.parent().unwrap().join("golden");

    eprintln!("=== Rust golden-vector check ===");
    eprintln!("seed: ({:#x}, {:#x}), n={}, fixed-time={}", SEED0, SEED1, N, TIMESTAMP_MS);

    let entries = [
        ("dbkey-single-parent", dbkey_layout()),
        ("multitenant-single-parent", multitenant_layout()),
        ("eventsourcing-single-parent", eventsourcing_layout()),
    ];

    let mut all_pass = true;
    for (label, layout) in &entries {
        let ts_path = golden_dir.join(format!("{}.txt", label));
        let content_ts = fs::read_to_string(&ts_path)
            .unwrap_or_else(|_| panic!("missing golden/{}.txt — run `bun run scripts/export-golden.ts` first", label));
        let ts_lines: Vec<&str> = content_ts.lines().collect();

        let mut rng = Xorshift128p::new(SEED0, SEED1);
        let mut monotonic = HashMap::new();
        let mut counters = HashMap::new();
        let rust_uuids = generate_batch(&mut rng, layout, label, &mut monotonic, &mut counters, N);

        let mut diff_count = 0;
        for i in 0..N {
            if rust_uuids[i] != ts_lines[i] {
                if diff_count < 5 {
                    eprintln!("  mismatch [{}] line {}: Rust={}, TS={}",
                        label, i + 1, rust_uuids[i], ts_lines[i]);
                }
                diff_count += 1;
            }
        }
        let status = if diff_count == 0 { "PASS" } else { "FAIL" };
        eprintln!("  {}: {} ({} mismatches)", label, status, diff_count);
        if diff_count > 0 { all_pass = false; }
    }

    if all_pass {
        eprintln!("=== RESULT: ALL PASS ===");
        println!("ALL_PASS");
    } else {
        eprintln!("=== RESULT: FAIL ===");
        std::process::exit(1);
    }
    Ok(())
}
