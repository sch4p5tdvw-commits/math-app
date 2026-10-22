# テスト

画面を通して、単語の登録から CSV、3つの出題、間隔反復、記録、
オフラインまでを一周する。単語はアプリに入っている自作サンプルを使う。

## 動かし方

    cd eitango && python3 -m http.server 8822 &
    cd tests && node test-app.js

Playwright と Chromium が要る。見つからないときは実行ファイルの場所を渡す。

    CHROMIUM_PATH=/path/to/chromium node test-app.js
