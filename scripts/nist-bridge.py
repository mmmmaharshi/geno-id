#!/usr/bin/env python3
"""Run full NIST SP 800-22 battery on GenoID, raw-v8, and v4 samples."""

import numpy as np
import scipy
scipy.zeros = np.zeros

import sys
import os
import json
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor


def load_bits(path: str) -> str:
    with open(path) as f:
        return f.read().strip()


def fmt(p: float) -> str:
    return f"{p:.6f}" if isinstance(p, float) else str(p)


def run_battery(label: str, bits: str) -> list:
    """Run all 15 NIST SP 800-22 tests on `bits`; return structured results.

    Pure compute — no I/O. The caller decides how to present the results
    (`format_battery` for the report, or `json.dumps` for machine output).
    """
    bits_len = len(bits)
    results = []

    def record(name: str, p, ok):
        results.append({"test": name, "p": fmt(p), "passed": bool(ok)})

    # 1. Frequency (Monobit)

    # 1. Frequency (Monobit)
    from nist80022.FrequencyTest import FrequencyTest

    ft = FrequencyTest()
    for name, p, ok in ft.monobit_test(bits):
        record(name, p, ok)

    # 2. Block Frequency
    for name, p, ok in ft.block_frequency(bits, block_size=128):
        record(f"block_frequency(m=128)", p, ok)

    # 3. Runs
    from nist80022.RunTest import RunTest

    rt = RunTest()
    r = rt.run_test(bits)
    if isinstance(r, list):
        for name, p, ok in r:
            record(name, p, ok)
    else:
        p, ok = r
        record("run_test", p, ok)

    # 4. Longest Run of Ones in a Block
    for name, p, ok in rt.longest_one_block_test(bits):
        record(name, p, ok)

    # 5. Binary Matrix Rank
    from nist80022.Matrix import Matrix

    mx = Matrix()
    for name, p, ok in mx.binary_matrix_rank_text(bits):
        record(name, p, ok)

    # 6. Discrete Fourier Transform (Spectral)
    from nist80022.Spectral import SpectralTest

    st = SpectralTest()
    for name, p, ok in st.spectral_test(bits):
        record(name, p, ok)

    # 7. Non-overlapping Template Matching
    from nist80022.TemplateMatching import TemplateMatching

    tm = TemplateMatching()
    for name, p, ok in tm.non_overlapping_test(bits, template_pattern="000000001"):
        record(f"{name}(B=000000001)", p, ok)

    # 8. Overlapping Template Matching
    for name, p, ok in tm.overlapping_patterns(bits, pattern_size=9, block_size=1032):
        record(f"{name}(m=9)", p, ok)

    # 9. Maurer's Universal Statistical
    from nist80022.Universal import Universal

    u = Universal()
    for name, p, ok in u.statistical_test(bits):
        record(name, p, ok)

    # 10. Linear Complexity
    from nist80022.Complexity import ComplexityTest

    ct = ComplexityTest()
    for name, p, ok in ct.linear_complexity_test(bits):
        record(name, p, ok)

    # 11. Serial (m=8)
    from nist80022.Serial import Serial

    s = Serial()
    for m in (8,):
        for name, p, ok in s.serial_test(bits, pattern_length=m):
            record(f"serial(m={m})", p, ok)

    # 12. Approximate Entropy (m=2)
    from nist80022.ApproximateEntropy import ApproximateEntropy

    ae = ApproximateEntropy()
    for m in (2,):
        for name, p, ok in ae.approximate_entropy_test(bits, pattern_length=m):
            record(f"approx_entropy(m={m})", p, ok)

    # 13. Cumulative Sums (Forward + Backward)
    from nist80022.CumulativeSum import CumulativeSums

    cs = CumulativeSums()
    for mode, mode_label in [(0, "forward"), (1, "backward")]:
        for name, p, ok in cs.cumulative_sums_test(bits, mode=mode):
            record(f"cumulative_sums({mode_label})", p, ok)

    # 14. Random Excursions
    from nist80022.RandomExcursions import RandomExcursions

    re = RandomExcursions()
    try:
        for name, p, ok in re.random_excursions_test(bits):
            p_str = ", ".join(f"{v:.6f}" for v in p) if isinstance(p, (list, tuple)) else fmt(p)
            ok_str = "PASS" if ok else "FAIL"
            record(name, p_str, ok)
    except Exception as e:
        record(f"random_excursions", str(e), False)

    # 15. Random Excursions Variant
    try:
        for name, p, ok in re.variant_test(bits):
            p_str = ", ".join(f"{v:.6f}" for v in p) if isinstance(p, (list, tuple)) else fmt(p)
            ok_str = "PASS" if ok else "FAIL"
            record(name, p_str, ok)
    except Exception as e:
        record(f"random_excursions_variant", str(e), False)

    return results


def format_battery(label: str, bits_len: int, results: list) -> list[str]:
    """Render a battery's results as the report's output lines."""
    lines = [
        "",
        "=" * 60,
        f"  NIST SP 800-22: {label}",
        f"  Bits: {bits_len:,}",
        "=" * 60,
    ]
    for r in results:
        ok_str = "PASS" if r["passed"] else "FAIL"
        lines.append(f"  {r['test']}: p={r['p']} {ok_str}")
    return lines


def _run_sample(job: tuple[str, str]) -> tuple[str, list, int]:
    """Pool worker: load one sample, run its battery, return results + length."""
    label, path = job
    bits = load_bits(path)
    return label, run_battery(label, bits), len(bits)


def main():
    root = Path(__file__).resolve().parent.parent
    dist = root / "dist"

    samples = [
        ("v4 (crypto.randomUUID)", str(dist / "v4.bits.txt")),
        ("raw-v8 (no GA)", str(dist / "ablation-rawv8.bits.txt")),
        ("genoid-full (crossover+mutation)", str(dist / "ablation-full.bits.txt")),
        ("crossover-only (no mutation)", str(dist / "ablation-xonly.bits.txt")),
        ("mutation-only (no crossover)", str(dist / "ablation-monly.bits.txt")),
    ]

    degraded_sources = ["biased", "correl", "restricted", "periodic", "lcg"]
    degraded_labels = {
        "biased": "P(1)=0.3 biased bytes",
        "correl": "byte XOR chain correlation",
        "restricted": "bytes 0-127 only",
        "periodic": "XOR with 4-byte repeating pattern",
        "lcg": "truncated LCG (glibc rand)",
    }
    for s in degraded_sources:
        desc = degraded_labels[s]
        samples.append((f"{s}-raw ({desc}, no GA)", str(dist / f"degraded-{s}-raw.bits.txt")))
        samples.append((f"{s}-ga ({desc}, +GA)", str(dist / f"degraded-{s}-ga.bits.txt")))

    # Structured GenoID layouts (random-field bits only)
    structured_samples = [
        ("genoid-structured-dbkey", "struct-dbkey.bits.txt"),
        ("genoid-structured-multitenant", "struct-multitenant.bits.txt"),
        ("genoid-structured-eventsourcing", "struct-eventsourcing.bits.txt"),
    ]
    for label, fn in structured_samples:
        samples.append((label, str(dist / fn)))

    # CLI: --file path --label "name" --json
    json_out = "--json" in sys.argv
    single_file = None
    single_label = None
    for i, arg in enumerate(sys.argv):
        if arg == "--file" and i + 1 < len(sys.argv):
            single_file = sys.argv[i + 1]
        if arg == "--label" and i + 1 < len(sys.argv):
            single_label = sys.argv[i + 1]

    if single_file:
        bits = load_bits(single_file)
        label = single_label if single_label else Path(single_file).stem
        results = run_battery(label, bits)
        if json_out:
            print(json.dumps(results, indent=2))
        else:
            print("\n".join(format_battery(label, len(bits), results)))
        return

    # Fan every sample's battery out across all CPU cores. numpy/scipy release
    # the GIL during the heavy C-backed tests, so a process pool gives a near
    # linear speedup over the serial loop; results are collected per sample and
    # printed in the original sample order so the report is unchanged.
    max_workers = os.cpu_count() or 1
    with ProcessPoolExecutor(max_workers=max_workers) as ex:
        for _label, results, bits_len in ex.map(_run_sample, samples):
            print("\n".join(format_battery(_label, bits_len, results)))


if __name__ == "__main__":
    main()
