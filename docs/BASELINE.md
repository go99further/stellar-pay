# Baseline Performance Measurement

**Measured:** 2026-05-10T11:12:06.006Z  
**Runs per scenario:** 20 (all 60 runs fired in parallel)  
**Provider:** DeepSeek  
**Model:** deepseek-v4-flash  

---

## Scenario 1: Single Agent (Analytics)

| | p50 | p95 | p99 | mean | min | max |
|---|---|---|---|---|---|---|
| Router | 4494 | 4736 | 4736 | 4504 | 4464 | 4736 |
| Agent | 5800 | 9467 | 9467 | 6042 | 3632 | 9467 |
| **Total** | **10283** | **13938** | **13938** | **10546** | **8159** | **13938** |

*(all values in ms)*

<details><summary>Raw runs</summary>

```
Run  1: router=4477ms  agent=5359ms  total=9836ms
Run  2: router=4477ms  agent=5305ms  total=9782ms
Run  3: router=4496ms  agent=6045ms  total=10541ms
Run  4: router=4527ms  agent=3632ms  total=8159ms
Run  5: router=4485ms  agent=5677ms  total=10162ms
Run  6: router=4495ms  agent=6568ms  total=11063ms
Run  7: router=4495ms  agent=6813ms  total=11308ms
Run  8: router=4494ms  agent=5640ms  total=10134ms
Run  9: router=4483ms  agent=5800ms  total=10283ms
Run 10: router=4492ms  agent=4484ms  total=8976ms
Run 11: router=4736ms  agent=6195ms  total=10931ms
Run 12: router=4478ms  agent=5321ms  total=9799ms
Run 13: router=4526ms  agent=4275ms  total=8801ms
Run 14: router=4527ms  agent=6226ms  total=10753ms
Run 15: router=4471ms  agent=9467ms  total=13938ms
Run 16: router=4499ms  agent=5151ms  total=9650ms
Run 17: router=4469ms  agent=7014ms  total=11483ms
Run 18: router=4498ms  agent=5677ms  total=10175ms
Run 19: router=4464ms  agent=9191ms  total=13655ms
Run 20: router=4493ms  agent=7004ms  total=11497ms
```
</details>

## Scenario 2: Single Agent (Trading)

| | p50 | p95 | p99 | mean | min | max |
|---|---|---|---|---|---|---|
| Router | 4496 | 4552 | 4552 | 4498 | 4467 | 4552 |
| Agent | 9217 | 14845 | 14845 | 9909 | 7310 | 14845 |
| **Total** | **13706** | **19312** | **19312** | **14406** | **11862** | **19312** |

*(all values in ms)*

<details><summary>Raw runs</summary>

```
Run  1: router=4498ms  agent=8988ms  total=13486ms
Run  2: router=4497ms  agent=8926ms  total=13423ms
Run  3: router=4528ms  agent=8436ms  total=12964ms
Run  4: router=4552ms  agent=7310ms  total=11862ms
Run  5: router=4474ms  agent=12133ms  total=16607ms
Run  6: router=4488ms  agent=9884ms  total=14372ms
Run  7: router=4496ms  agent=11223ms  total=15719ms
Run  8: router=4472ms  agent=12521ms  total=16993ms
Run  9: router=4479ms  agent=10411ms  total=14890ms
Run 10: router=4496ms  agent=8740ms  total=13236ms
Run 11: router=4496ms  agent=9593ms  total=14089ms
Run 12: router=4470ms  agent=8766ms  total=13236ms
Run 13: router=4493ms  agent=14104ms  total=18597ms
Run 14: router=4528ms  agent=8596ms  total=13124ms
Run 15: router=4489ms  agent=9217ms  total=13706ms
Run 16: router=4499ms  agent=7837ms  total=12336ms
Run 17: router=4467ms  agent=14845ms  total=19312ms
Run 18: router=4526ms  agent=7705ms  total=12231ms
Run 19: router=4476ms  agent=10521ms  total=14997ms
Run 20: router=4528ms  agent=8415ms  total=12943ms
```
</details>

## Scenario 3: Two Agents Serial (Analytics + Security)

| | p50 | p95 | p99 | mean | min | max |
|---|---|---|---|---|---|---|
| Router | 4488 | 4610 | 4610 | 4493 | 4465 | 4610 |
| Agent | 14297 | 20064 | 20064 | 14737 | 10300 | 20064 |
| **Total** | **18788** | **24537** | **24537** | **19230** | **14817** | **24537** |

*(all values in ms)*

<details><summary>Raw runs</summary>

```
Run  1: router=4473ms  agent=20064ms  total=24537ms
Run  2: router=4484ms  agent=13379ms  total=17863ms
Run  3: router=4479ms  agent=15901ms  total=20380ms
Run  4: router=4470ms  agent=14098ms  total=18568ms
Run  5: router=4497ms  agent=11922ms  total=16419ms
Run  6: router=4493ms  agent=14557ms  total=19050ms
Run  7: router=4474ms  agent=17744ms  total=22218ms
Run  8: router=4492ms  agent=13934ms  total=18426ms
Run  9: router=4473ms  agent=19567ms  total=24040ms
Run 10: router=4610ms  agent=14303ms  total=18913ms
Run 11: router=4477ms  agent=13001ms  total=17478ms
Run 12: router=4497ms  agent=10320ms  total=14817ms
Run 13: router=4487ms  agent=12342ms  total=16829ms
Run 14: router=4488ms  agent=12551ms  total=17039ms
Run 15: router=4491ms  agent=14297ms  total=18788ms
Run 16: router=4477ms  agent=17020ms  total=21497ms
Run 17: router=4549ms  agent=10300ms  total=14849ms
Run 18: router=4496ms  agent=13105ms  total=17601ms
Run 19: router=4492ms  agent=19200ms  total=23692ms
Run 20: router=4465ms  agent=17137ms  total=21602ms
```
</details>

---

## Key Findings

| Scenario | p50 total | p95 total |
|---|---|---|
| S1 Analytics | 10283ms | 13938ms |
| S2 Trading | 13706ms | 19312ms |
| S3 Analytics+Security (serial) | 18788ms | 24537ms |

**Parallelization opportunity (S3):**
- Current serial: 18788ms (p50)
- Estimated parallel: ~10288ms (router + max agent)
- Potential saving: ~8500ms (~45.2%)

---

*This is the pre-optimization baseline. Next step: implement Intent Graph Dispatcher (single + parallel modes).*
