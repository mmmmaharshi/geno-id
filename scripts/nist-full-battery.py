#!/usr/bin/env python3
"""Run the FULL NIST SP 800-22 battery (all 15 tests) on GenoID structured layouts.

The nist80022 package provides 14 tests; Block Frequency (T2) is not implemented
by the package, so it is implemented here per SP 800-22 sec 2.2.
"""

import json
import math
import os
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import scipy
scipy.zeros = np.zeros
from scipy.special import gammaincc

from nist80022.FrequencyTest import FrequencyTest
from nist80022.RunTest import RunTest
from nist80022.Matrix import Matrix
from nist80022.Spectral import SpectralTest
from nist80022.TemplateMatching import TemplateMatching
from nist80022.Universal import Universal
from nist80022.Complexity import ComplexityTest
from nist80022.Serial import Serial
from nist80022.ApproximateEntropy import ApproximateEntropy
from nist80022.CumulativeSum import CumulativeSums
from nist80022.RandomExcursions import RandomExcursions

ALPHA = 0.01


def load_bits(path):
    with open(path) as f:
        return f.read().strip()


def block_frequency_test(binary_data: str, block_size: int = 128, verbose: bool = False):
    """NIST SP 800-22 sec 2.2 — Frequency within a Block (Chi-square)."""
    n = len(binary_data)
    n_blocks = n // block_size
    if n_blocks < 1:
        return [("BlockFrequency", 0.0, False)]
    chi = 0.0
    for i in range(n_blocks):
        block = binary_data[i * block_size:(i + 1) * block_size]
        ones = block.count("1")
        pi = ones / block_size
        chi += (pi - 0.5) ** 2
    chi = 4.0 * block_size * chi
    p_value = gammaincc(n_blocks / 2.0, chi / 2.0)
    return [("BlockFrequency", float(p_value), bool(p_value >= ALPHA))]


def run_one(job):
    label, bits = job
    results = []

    def add(name, res):
        for entry in res:
            results.append({"layout": label, "test": name,
                            "p_value": round(float(entry[1]), 6),
                            "status": "PASS" if entry[2] else "FAIL"})

    # 1. Frequency (Monobit)
    add("Frequency", FrequencyTest.monobit_test(bits))
    # 2. Block Frequency (implemented here)
    add("BlockFrequency", block_frequency_test(bits))
    # 3. Runs
    add("Runs", RunTest.run_test(bits))
    # 4. Longest Run of Ones in a Block
    add("LongestRun", RunTest.longest_one_block_test(bits))
    # 5. Binary Matrix Rank
    add("MatrixRank", Matrix.binary_matrix_rank_text(bits))
    # 6. Discrete Fourier Transform (Spectral)
    add("Spectral(DFT)", SpectralTest.spectral_test(bits))
    # 7. Non-overlapping Template Matching
    add("NonOverlappingTemplate", TemplateMatching.non_overlapping_test(bits))
    # 8. Overlapping Template Matching
    add("OverlappingTemplate", TemplateMatching.overlapping_patterns(bits))
    # 9. Maurer's Universal Statistical
    add("Universal", Universal.statistical_test(bits))
    # 10. Linear Complexity
    add("LinearComplexity", ComplexityTest.linear_complexity_test(bits))
    # 11. Serial
    add("Serial", Serial.serial_test(bits))
    # 12. Approximate Entropy
    add("ApproximateEntropy", ApproximateEntropy.approximate_entropy_test(bits))
    # 13. Cumulative Sums (forward + reverse)
    add("CumulativeSums(forward)", CumulativeSums.cumulative_sums_test(bits, mode=0))
    add("CumulativeSums(reverse)", CumulativeSums.cumulative_sums_test(bits, mode=1))
    # 14. Random Excursions
    add("RandomExcursions", RandomExcursions.random_excursions_test(bits))
    # 15. Random Excursions Variant
    add("RandomExcursionsVariant", RandomExcursions.variant_test(bits))
    return label, results


def main():
    root = Path(__file__).resolve().parent.parent
    dist = root / "dist"

    layout_files = {
        "dbkey": dist / "struct-dbkey.bits.txt",
        "multitenant": dist / "struct-multitenant.bits.txt",
        "eventsourcing": dist / "struct-eventsourcing.bits.txt",
    }

    samples = []
    for label, path in layout_files.items():
        if path.exists():
            bits = load_bits(str(path))
            print(f"{label}: {len(bits)} bits loaded")
            samples.append((label, bits))
        else:
            print(f"WARNING: {path} not found")

    all_results = []
    layout_summary = {}

    with ProcessPoolExecutor(max_workers=min(len(samples), os.cpu_count() or 4)) as pool:
        for label, results in pool.map(run_one, samples):
            layout_summary[label] = results
            all_results.extend(results)

    # Summary table
    total = len(all_results)
    passed = sum(1 for r in all_results if r["status"] == "PASS")
    failed = total - passed

    print("\n=== NIST SP 800-22 FULL BATTERY (15 tests x 3 layouts) ===")
    print(f"Total: {passed}/{total} PASS ({failed} FAIL)\n")

    for label in layout_summary:
        results = layout_summary[label]
        npass = sum(1 for r in results if r["status"] == "PASS")
        print(f"{label}: {npass}/{len(results)} PASS")
        for r in results:
            flag = "" if r["status"] == "PASS" else "   <-- FAIL"
            print(f"    {r['test']:<28} p={r['p_value']:.6f}  {r['status']}{flag}")
        print()

    outpath = dist / "nist-sp800-22-full-results.json"
    payload = {
        "alpha": ALPHA,
        "total_tests": total,
        "passed": passed,
        "failed": failed,
        "results": all_results,
    }
    with open(outpath, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Results saved: {outpath}")

    # Exit non-zero if any test failed
    raise SystemExit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
