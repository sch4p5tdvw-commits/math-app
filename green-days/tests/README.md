# テスト

読み取りの取りこぼしは、画面を見ただけでは気づけない。貼り付けた文章が
何件の売上になるかを、実際のブラウザで動かして突き合わせる。

商品や店舗は `seed.js` の作り物を使う。実際の売上データは端末の中だけに
あり、ここには置かない。

## 動かし方

    cd green-days && python3 -m http.server 8811 &
    cd tests && node test-parse.js && node test-app.js

Playwright と Chromium が要る。見つからないときは実行ファイルの場所を渡す。

    CHROMIUM_PATH=/path/to/chromium node test-parse.js

- `test-parse.js` … 貼り付けた文章 → 売上の行。店の確定売上（値段ちがいが
  同じ品名の下に並ぶ形）、単位の表記ゆれ、かっこ書き、未登録の品名など
- `test-app.js` … 取込から登録・集計・履歴の修正まで、画面を通して一周する
