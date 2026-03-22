// ローカルストレージに保存されているプロフィールURLを取得
let myProfileUrl = localStorage.getItem("myProfileUrl");

// タイマーとストックの状態管理
let timerInterval = null;
let timeLeft = 60;
let currentStock = 0;
let isTimerRunning = false;
let isBlocked = false;

// 拡張機能が読み込まれた時にストックを初期化または読み込み
chrome.storage.local.get(['stock', 'lastDate'], (result) => {
  const today = new Date().toLocaleDateString();
  currentStock = result.stock;
  
  // 新しい日ならストックを10にリセット
  if (result.lastDate !== today || currentStock === undefined) {
    currentStock = 10;
    chrome.storage.local.set({ stock: currentStock, lastDate: today });
  }
});

function checkPage() {
  // 常に画面内のプロフィールリンクを確認し、最新のアカウントURLに更新する（複数アカウント切替対応）
  const linkObj = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  if (linkObj) {
    const currentUrl = linkObj.getAttribute("href").toLowerCase();
    if (myProfileUrl !== currentUrl) {
      myProfileUrl = currentUrl;
      localStorage.setItem("myProfileUrl", myProfileUrl);
    }
  }

  const path = window.location.pathname.toLowerCase();

  // ログイン画面などのシステム系URLは常に許可する
  if (path.startsWith('/i/') || path === '/login' || path === '/logout') {
    allowAccess();
    return;
  }

  // IDがまだ取得できていない間は、いったんブロックせずに画面を読み込ませる
  if (!myProfileUrl) {
    allowAccess();
    return;
  }

  // プロフィール、投稿画面、または入力エリアが表示されているか判定
  const isAllowed = path.startsWith(myProfileUrl) || isPosting();

  if (isAllowed) {
    allowAccess();
  } else {
    restrictAccess();
  }
}

function isPosting() {
  const path = window.location.pathname.toLowerCase();
  
  // URLによる判定
  if (path.startsWith('/compose/post') || path.startsWith('/intent/tweet')) {
    return true;
  }
  
  // セレクターを増やして検知力を高める
  const composerSelectors = [
    '[data-testid="tweetTextarea_0"]',
    '[data-testid="tweetTextarea_0_RichEditor_EditableObject"]',
    '.DraftEditor-root',
    '[role="dialog"] [contenteditable="true"]'
  ];

  for (const selector of composerSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      // ダイアログ（モーダル）内にあるか、現在フォーカスされているか
      if (el.closest('[role="dialog"]') || document.activeElement === el || el.contains(document.activeElement)) {
        return true;
      }
    }
  }
  
  return false;
}

function allowAccess() {
  // プロフィール画面などにいる場合は、ブロックを解除しタイマーを隠す/停止する
  const blocker = document.getElementById("twitter-block");
  if (blocker) blocker.remove();
  isBlocked = false;

  stopTimer();
  const timerContainer = document.getElementById("twitter-timer-container");
  if (timerContainer) timerContainer.style.display = 'none';
}

function restrictAccess() {
  if (isBlocked) return;

  // タイマーが動いていない場合
  if (!isTimerRunning) {
    if (currentStock <= 0) {
      showBlocker(true, 0);
      return;
    }
    
    // 現在の時間が0以下ならリセット（新しいセッション）
    if (timeLeft <= 0) {
      timeLeft = 60;
    }
    
    // タイマーUIを表示・更新
    const timerContainer = document.getElementById("twitter-timer-container");
    if (timerContainer) {
      timerContainer.style.display = 'flex';
      const stockElement = document.getElementById("twitter-stock");
      if (stockElement) stockElement.innerText = `残りストック: ${currentStock} 回`;
      const timerElement = document.getElementById("twitter-timer");
      if (timerElement) timerElement.innerText = `残り ${timeLeft} 秒`;
    } else {
      createTimerUI(currentStock);
    }
    
    startTimer();
  }
}

function createTimerUI(stock) {
  const container = document.createElement("div");
  container.id = "twitter-timer-container";
  container.innerHTML = `
    <div id="twitter-timer">残り ${timeLeft} 秒</div>
    <div id="twitter-stock">残りストック: ${stock} 回</div>
  `;
  document.body.appendChild(container);
}

function startTimer() {
  if (isTimerRunning) return;
  isTimerRunning = true;
  
  timerInterval = setInterval(() => {
    timeLeft--;
    const timerElement = document.getElementById("twitter-timer");
    if (timerElement) timerElement.innerText = `残り ${timeLeft} 秒`;

    if (timeLeft <= 0) {
      stopTimer();
      decrementStock();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isTimerRunning = false;
}

function decrementStock() {
  chrome.storage.local.get(['stock'], (result) => {
    currentStock = Math.max(0, (result.stock || 10) - 1);
    chrome.storage.local.set({ stock: currentStock }, () => {
      showBlocker(false, currentStock); // 通常の終了
    });
  });
}

function showBlocker(isOutOfStock, remainingStock = 0) {
  isBlocked = true;
  stopTimer();
  
  const timerContainer = document.getElementById("twitter-timer-container");
  if (timerContainer) timerContainer.style.display = 'none';

  if (document.getElementById("twitter-block")) return;

  const overlay = document.createElement("div");
  overlay.id = "twitter-block";
  
  const message = isOutOfStock 
    ? "今日のストックがなくなりました<br>また明日お会いしましょう 💤"
    : "1分経過しました<br>Twitterは終了です";

  // ストックの図形表示を生成（10個のドット）
  let stockDots = '';
  for (let i = 0; i < 10; i++) {
    const statusClass = i < remainingStock ? 'active' : 'used';
    stockDots += `<div class="stock-dot ${statusClass}"></div>`;
  }

  overlay.innerHTML = `
    <div class="block-content">
      <div class="block-message">
        ${isOutOfStock ? "🚫" : ""} ${message}
      </div>
      <div class="stock-visualizer">
        ${stockDots}
      </div>
      <div class="stock-text-small">
        残りストック: ${remainingStock} / 10
      </div>
      <button id="go-profile-btn" style="
        margin-top: 40px;
        padding: 18px 40px;
        font-size: 20px;
        font-weight: bold;
        color: white;
        background-color: #1d9bf0;
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(29, 155, 240, 0.3);
        transition: background-color 0.2s;
      ">
        プロフィール画面へ行く
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  // ボタンイベントを設定
  const btn = document.getElementById("go-profile-btn");
  if (btn) {
    btn.addEventListener("mouseover", () => { btn.style.backgroundColor = "#1a8cd8"; });
    btn.addEventListener("mouseout", () => { btn.style.backgroundColor = "#1d9bf0"; });
    btn.addEventListener("click", () => {
      if (myProfileUrl) {
        window.location.href = myProfileUrl;
      }
    });
  }
}

// 0.5秒ごとにURLの変更やプロフィール情報の取得を監視
setInterval(checkPage, 500);
