#!/usr/bin/env python3
"""Run full NIST SP 800-22 battery on GenoID structured layouts."""

import os
import json
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

try:
    from nist80022.test_suite import run_battery as _nist_run_battery
except ImportError:
    print("ERROR: pip install nist80022 required")
    exit(1)

def load_bits(path):
    with open(path) as f:
        return f.read().strip()

def run_single(args):
    label, bits = args
    try:
        results = _nist_run_battery(bits, verbose=False)
        return label, [(r[0], float(r[1])) if isinstance(r, tuple) and len(r) == 2 else (str(r), 0.0) for r in results]
    except Exception as e:
        return label, [("error", str(e))]

def main():
    root = Path(__file__).resolve().parent.parent
    dist = root / "dist"

    # Structured layout samples
    layout_samples = []
    for name in ["struct-dbkey", "struct-multitenant", "struct-eventsourcing"]:
        path = dist / f"{name}.bits.txt"
        if path.exists():
            layout_samples.append((name.replace("struct-", ""), str(path)))
        else:
            print(f"WARNING: {path} not found, skipping")

    if not layout_samples:
        print("No sample files found.")
        exit(1)

    samples = [(label, load_bits(path)) for label, path in layout_samples]
    results_by_layout = {}
    all_results = []

    with ProcessPoolExecutor(max_workers=min(len(samples), os.cpu_count() or 4)) as pool:
        for label, battery_results in pool.map(run_single, samples):
            results_by_layout[label] = battery_results
            for test_name, pval in battery_results:
                status = "PASS" if pval >= 0.01 else "FAIL"
                entry = {"layout": label, "test": test_name, "p_value": round(pval, 6), "status": status}
                all_results.append(entry)
                if status == "FAIL":
                    print(f"  FAIL: {label}/{test_name}: p={pval:.6f}")

    total_tests = len(all_results)
    pass_count = sum(1 for r in all_results if r["status"] == "PASS")
    fail_count = total_tests - pass_count

    print("\n=== NIST SP 800-22 Results ===")
    print(f"Total: {pass_count}/{total_tests} PASS ({fail_count} FAIL)")
    print()
    for layout in sorted(results_by_layout.keys()):
        result_list = results_by_layout[layout]
        print(f"\n{layout}:")
        for test_name, pval in result_list:
            s = "PASS" if (isinstance(pval, (int, float)) and pval >= 0.01) else ("FAIL" if isinstance(pval, (int, float)) else str(pval))
            print(f"  {test_name}: p={pval} {s}")

    outpath = dist / "nist-sp800-22-results.json"
    with open(outpath, "w") as f:
        json.dump({"total_tests": total_tests, "passed": pass_count, "failed": fail_count, "results": all_results}, f, indent=2)
    print(f"\nResults saved: {outpath}")

if __name__ == "__main__":
    main()
