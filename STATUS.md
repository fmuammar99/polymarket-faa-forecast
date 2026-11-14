# polymarket-faa-attribution-02 — entry status

## Ringkasan

Forecaster kuantil untuk harga Yes Polymarket, 240 menit ke depan x 5 kuantil
(0.05/0.25/0.5/0.75/0.95), satu file `main.ts` (Node 22, stdlib-only).
**Loss practice 0.269496 vs baseline starter 0.363589 (-25.9%)**, lebih baik di
keenam practice case. Layak di-submit: margin di atas baseline besar dan
konsisten per case, tapi ingat practice adalah event lain (NVIDIA CEO), jadi
ini bukan jaminan untuk final FAA — dan hadiah final juga mensyaratkan loss di
bawah baseline model house (superbot), yang tidak bisa diukur sebelum final.

## Metode (main.ts)

Median = harga terakhir (tanpa drift: semua drift tren / mean-reversion yang
dicoba memperburuk loss). Spread = `sigma * h^0.4` (bukan `sqrt(h)`: penyebaran
perubahan harga-h tumbuh lebih lambat dari akar karena harga adalah probabilitas
terbatas yang mean-revert), blend dua pandangan:

1. **Linear (bobot 0.7):** sigma = EWMA mean |perubahan 1 menit| (half-life
   240 menit) x 1.2533, clip [0.0005, 0.012], x 0.9.
2. **Logit (bobot 0.3):** konstruksi yang sama di ruang log-odds (harga clip
   [1e-4, 1-1e-4]), sigma dari mean |perubahan logit| 360 menit terakhir,
   clip [0.001, 0.05], x 0.9, kembali lewat sigmoid. Memberi gerakan
   multiplikatif untuk market berharga kecil.
3. Kuantil luar dilebarkan 1.3x (z 0.05/0.95 = ±2.138): lompatan di luar spread
   normal sering terjadi dan pinball di ekor menghukum interval yang terlalu
   sempit. Tiap pandangan di-clamp [0,1] dulu sebelum di-blend.

Temuan selama tuning (skor practice, mean pinball loss, makin kecil makin baik):

| Model | Loss |
|---|---|
| Baseline starter (sigma 0.0025 tetap, sqrt(h)) | 0.363589 |
| sigma = std dev perubahan 1 mnt (72 jam) | 0.827828 (std rusak oleh lompatan) |
| sigma = mean\|d\| 72 jam | 0.352230 |
| sigma = mean\|d\| 6 jam terakhir | 0.283859 |
| Kuantil empiris perubahan-h (72 jam / 24 jam) | 0.376042 / 0.367497 |
| Logit saja | 0.294295 |
| + drift tren / + mean-reversion ke mean 72 jam | 0.29–0.57 (lebih buruk) |
| **Final: EWMA hl240 + logit blend 70/30, h^0.4, z-luar 1.3x** | **0.269496** |

## Loss practice per case (final vs baseline)

| Case | Final | Baseline |
|---|---|---|
| p00 | 0.463774 | 0.536138 |
| p01 | 0.309191 | 0.380352 |
| p02 | 0.356198 | 0.408408 |
| p03 | 0.240320 | 0.368599 |
| p04 | 0.209270 | 0.298794 |
| p05 | 0.103815 | 0.238232 |
| **Mean** | **0.269496** | **0.363589** |

Median error 0.767503 (sama dengan baseline — median = harga terakhir di
keduanya); coverage_90 0.859440 (sedikit di bawah 0.90 nominal; melebarkan
interval sudah dicoba dan memperburuk loss).

## Validasi lokal

- Scorer lokal (Python, di `~/workspace/makefun/polymarket-eval/score.py`)
  direkonstruksi aktual practice dari case berikutnya + harga p05 yang diambil
  dari CLOB Polymarket; scorer ini mereproduksi angka server untuk baseline
  **persis**: loss 0.363589, median error 0.767503, coverage 0.949642.
- Format output: semua 6 case valid — 240 baris x 5 kuantil per market, ID
  market sama dan urut seperti input, nilai di [0,1], tak menurun per baris,
  ukuran 179–250 KB per file (< 1 MiB).
- Deterministik: 2 run menghasilkan byte yang identik (`diff -r` kosong).
- Waktu: ~0.25–0.29 detik per case, sendiri-sendiri seperti grader
  (batas 8 detik). Edge case FAA-like (4 market, histori 960/120/1 menit,
  harga 0 dan 1) berjalan tanpa crash dan format tetap valid.

## Cara menjalankan

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out \
  ~/workspace/makefun/node22/node-v22.23.5-linux-x64/bin/node main.ts
```

## Langkah submit yang tersisa (untuk parent — JANGAN dilakukan di sini)

Bounty ini **escrowed**, jadi submit wajib `--keypair`. Deadline entry
**14 Nov 2026 14:00 UTC (21:00 WIB)**.

1. Buat repo GitHub publik baru (mis. `fmuammar99/polymarket-faa-forecast`),
   commit `main.ts`, `LICENSE`, `STATUS.md` ini, push.
2. Dari kit (`~/workspace/makefun/polymarket-faa-attribution-02-kit/polymarket-faa-attribution-02-kit/`):
   `node cli/makefun.mjs bundle --repo ~/workspace/makefun/polymarket --out transcripts.tar.gz --muse-usage <file>`
   (usage rows dari muse.db untuk session ini + parent).
3. `node cli/makefun.mjs check --kit . --repo ~/workspace/makefun/polymarket --transcripts transcripts.tar.gz` — harus 0 failed.
4. `node cli/makefun.mjs submit --competition polymarket-faa-attribution-02 --repo-url https://github.com/fmuammar99/polymarket-faa-forecast --commit <sha> --title "<judul>" --bundle transcripts.tar.gz --keypair ~/workspace/makefun/makefun-keypair.json`
5. `node cli/makefun.mjs status --submission <id>` untuk konfirmasi.

## Penilaian jujur: layak submit?

**Ya, dengan catatan.** Margin practice -25.9% dan menang di semua 6 case
adalah sinyal yang kuat, dan modelnya sederhana/robust (tanpa drift yang
rapuh, volatilitas adaptif yang cocok untuk market yang digerakkan berita —
persis karakter final FAA). Risiko utama: practice memakai event NVIDIA
(19–24 market, harga kebanyakan kecil), sedangkan final hanya 4 market FAA
yang baru dibuat 13 Nov malam dan digerakkan satu berita yang sedang
berlangsung — rezim volatilitasnya bisa berbeda, dan baseline model house
(superbot, dengan drift+sigma per market) tidak bisa dibandingkan sebelum
final. Tidak ada yang bisa diperbaiki lagi dalam waktu yang tersisa tanpa
risiko overfitting ke 6 case practice. Submit apa adanya.
