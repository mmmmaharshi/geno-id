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
    fn fill_bytes(&mut self, buf: &mut [u8]) {
        let mut off = 0;
        while off < buf.len() {
            let mut t = self.s1;
            t ^= t << 23;
            t ^= t >> 17;
            t ^= self.s0;
            t ^= self.s0 >> 26;
            self.s0 = self.s1;
            self.s1 = t;
            let val = self.s1;
            let n = (buf.len() - off).min(4);
            for i in 0..n {
                buf[off + i] = ((val >> (i * 8)) & 0xff) as u8;
            }
            off += n;
        }
    }
}

// === Counter state (tick-keyed, matches TypeScript CounterState) ===
#[derive(Clone, Copy)]
struct CounterState {
    tick: u64,
    ctr: u64,
}

// === Layout ===
#[derive(Clone, Debug)]
enum FieldType {
    TimestampMs,
    Counter,
    Shard,
    Node,
}

#[derive(Clone, Debug, Default)]
struct Constraint {
    allowed: Option<Vec<u32>>,
    min: Option<u64>,
    max: Option<u64>,
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

// === Repair (matches TypeScript repairConstraints — index-modulo + tick-keyed counter) ===
fn repair_constraints(
    buf: &mut [u8; 16],
    fields: &[Field],
    counters: &mut HashMap<String, CounterState>,
    layout_name: &str,
    now: u64,
) {
    for f in fields {
        let c = match &f.constraint {
            Some(c) => c,
            None => continue,
        };
        let raw = read_bits(buf, f.start, f.length);
        let mut v = raw;
        let mut changed = false;

        // allowed: idempotent index-modulo — only pick when v not already valid (algo.ts:691-693)
        if let Some(allowed) = &c.allowed {
            if !allowed.is_empty() && !allowed.contains(&(v as u32)) {
                let picked = allowed[(v as usize) % allowed.len()] as u64;
                v = picked;
                changed = true;
            }
        }

        // min/max: clamp (algo.ts:701-702)
        if let Some(min) = c.min {
            if v < min { v = min; changed = true; }
        }
        if let Some(max) = c.max {
            if v > max { v = max; changed = true; }
        }

        // monotonic: tick-keyed counter, 1 guard bit (algo.ts:703-719).
        // On first init TS seeds ctr = v % reseed_range and then falls through
        // to the tick check, where tick == state.tick, taking the increment
        // branch — so the effective first value is (v % reseed_range) + 1.
        // On a genuine tick change TS reseeds to v % reseed_range with NO
        // increment.
        if c.monotonic {
            let key = format!("{}:{}", layout_name, f.name);
            let field_range = 1u64 << f.length;
            let reseed_range = 1u64 << (f.length - 1); // guardBits = 1

            match counters.get(&key).copied() {
                // First init seeds only — no increment (algo.ts:706-711).
                None => {
                    let st = CounterState { tick: now, ctr: v % reseed_range };
                    counters.insert(key, st);
                    v = st.ctr;
                }
                Some(mut st) => {
                    let tick = now.max(st.tick);
                    if tick != st.tick {
                        st.tick = tick;
                        st.ctr = v % reseed_range;
                    } else {
                        st.ctr = (st.ctr + 1) % field_range;
                    }
                    counters.insert(key, st);
                    v = st.ctr;
                }
            }
            changed = true;
        }

        let _ = raw;

        if changed {
            write_bits(buf, f.start, f.length, v);
        }
    }
}

// === Layout definitions ===
const TIMESTAMP_MS: u64 = 1_700_000_000_000;

fn generate_batch(
    rng: &mut Xorshift128p,
    fields: &[Field],
    layout_name: &str,
    counters: &mut HashMap<String, CounterState>,
    count: usize,
) -> Vec<String> {
    const STRUCT_ENTRY: usize = 34;
    const POOL_SIZE: usize = 1024;
    let pool_bytes = STRUCT_ENTRY * POOL_SIZE;

    let mut pool = vec![0u8; pool_bytes];
    rng.fill_bytes(&mut pool);

    // Separate from `counters`: mirrors _poolMonoTick vs _counterStates.
    let mut pool_mono: HashMap<String, CounterState> = HashMap::new();

    let mut strings = Vec::with_capacity(POOL_SIZE);
    for n in 0..POOL_SIZE {
        let off = n * STRUCT_ENTRY;
        let mut buf = [0u8; 16];
        buf.copy_from_slice(&pool[off..off + 16]);

        // applyStructuredFields (algo.ts:618-632): ONLY fixed and timestamp-*
        // are written. counter / shard / node / random keep raw pool bytes.
        for f in fields {
            match f.ftype {
                FieldType::TimestampMs => {
                    let m = if f.length < 64 { 1u64 << f.length } else { 0 };
                    let val = if m > 0 { TIMESTAMP_MS % m } else { TIMESTAMP_MS };
                    write_bits(&mut buf, f.start, f.length, val);
                }
                _ => {}
            }
        }

        // Pool-level monotonic pass (algo.ts:736-753). This runs BEFORE
        // repairConstraints and uses a SEPARATE state map (_poolMonoTick),
        // so the counter is advanced twice per UUID; the repair pass writes
        // last, but this pass determines the value repair reads at first init.
        for f in fields {
            let is_mono = f.constraint.as_ref().map(|c| c.monotonic).unwrap_or(false);
            if !is_mono {
                continue;
            }
            let key = format!("{}:{}", layout_name, f.name);
            let field_range = 1u64 << f.length;
            let reseed_range = 1u64 << (f.length - 1);
            let v = read_bits(&buf, f.start, f.length);

            let out = match pool_mono.get(&key).copied() {
                None => {
                    let st = CounterState { tick: TIMESTAMP_MS, ctr: v % reseed_range };
                    pool_mono.insert(key, st);
                    st.ctr
                }
                Some(mut st) => {
                    let tick = TIMESTAMP_MS.max(st.tick);
                    if tick != st.tick {
                        st.tick = tick;
                        st.ctr = v % reseed_range;
                    } else {
                        st.ctr = (st.ctr + 1) % field_range;
                    }
                    pool_mono.insert(key, st);
                    st.ctr
                }
            };
            write_bits(&mut buf, f.start, f.length, out);
        }

        force_version_variant(&mut buf);
        repair_constraints(&mut buf, fields, counters, layout_name, TIMESTAMP_MS);
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
            constraint: Some(Constraint { allowed: Some(vec![1, 2, 3, 4, 5]), ..Default::default() }) },
        Field { name: "counter".into(), start: 66, length: 16, ftype: FieldType::Counter,
            constraint: Some(Constraint { monotonic: true, ..Default::default() }) },
    ]
}

fn multitenant_layout() -> Vec<Field> {
    vec![
        Field { name: "tenant".into(), start: 0, length: 12, ftype: FieldType::Shard,
            constraint: Some(Constraint { allowed: Some(vec![1, 2, 3, 4, 5, 6, 7, 8]), ..Default::default() }) },
        Field { name: "region".into(), start: 52, length: 8, ftype: FieldType::Shard,
            constraint: Some(Constraint { allowed: Some(vec![1, 2, 3, 4]), ..Default::default() }) },
    ]
}

fn eventsourcing_layout() -> Vec<Field> {
    vec![
        Field { name: "stream".into(), start: 0, length: 16, ftype: FieldType::Node, constraint: None },
        Field { name: "seq".into(), start: 66, length: 24, ftype: FieldType::Counter,
            constraint: Some(Constraint { monotonic: true, ..Default::default() }) },
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
        let mut counters = HashMap::new();
        let rust_uuids = generate_batch(&mut rng, layout, label, &mut counters, N);

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
