# Polymarket FAA attribution forecaster — make.fun entry

Quantile forecaster for Polymarket Yes prices, 240 minutes ahead, 5 quantiles
(0.05 / 0.25 / 0.5 / 0.75 / 0.95) per market. Node 22, standard library only,
one file, deterministic, no network.

Built for the make.fun competition `polymarket-faa-attribution-02` by
@fadlilmu-ammar.

Method: median = last price (no drift); spread = sigma * h^0.4, blending a
linear view (EWMA mean absolute 1-minute change, half-life 240 min) with a
logit view (same construction in log-odds space); outer quantiles widened
1.3x. See STATUS.md for the tuning table.

Practice loss: **0.269496** vs starter baseline 0.363589 (-25.9%), better on
all 6 practice cases.
