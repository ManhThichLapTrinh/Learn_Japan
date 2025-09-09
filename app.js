// ===== Data: 46 Hiragana cơ bản =====
const KANA = [
  ["あ","a"],["い","i"],["う","u"],["え","e"],["お","o"],
  ["か","ka"],["き","ki"],["く","ku"],["け","ke"],["こ","ko"],
  ["さ","sa"],["し","shi"],["す","su"],["せ","se"],["そ","so"],
  ["た","ta"],["ち","chi"],["つ","tsu"],["て","te"],["と","to"],
  ["な","na"],["に","ni"],["ぬ","nu"],["ね","ne"],["の","no"],
  ["は","ha"],["ひ","hi"],["ふ","fu"],["へ","he"],["ほ","ho"],
  ["ま","ma"],["み","mi"],["む","mu"],["め","me"],["も","mo"],
  ["や","ya"],["ゆ","yu"],["よ","yo"],
  ["ら","ra"],["り","ri"],["る","ru"],["れ","re"],["ろ","ro"],
  ["わ","wa"],["を","wo"],["ん","n"]
];

// ===== Helpers & State =====
const $ = (s, r=document) => r.querySelector(s);
const quizEl = $("#quiz");
const scoreEl = $("#score");
const actions = $("#actions");
const resultBox = $("#result");
const checkWrap = $("#checkWrap");
const checkBtn = $("#check");
const retryBtn = $("#retryWrong");
const exportBtn = $("#exportResult");

const progressBar = $("#progressBar");
const progressText = $("#progressText");
const timerEl = $("#timer");
const metaBar = $("#metaBar");

// state
const QuizState = {
  seed: null,
  startTime: null,
  endTime: null,
  items: [],       // [{kanaSeq, romaSeq, askH2R}]
  bank: [],
  answered: 0,
  total: 0,
  timerSec: 0,
  tick: null,
  locked: false,
  lastExport: null
};

// ===== Random utils =====
function seededRandom(seed){
  let t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  }
}
function shuffle(arr, rng=Math.random){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(rng()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function pickN(arr, n, rng=Math.random){ return shuffle(arr, rng).slice(0,n); }

// ===== Core helpers =====
function makeBank(includeWo=true){ return KANA.filter(([k,r]) => includeWo ? true : r!=="wo"); }
function normalize(s){ return String(s||"").trim().toLowerCase(); }
function msToClock(ms){
  const sec = Math.max(0, Math.round(ms/1000));
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}
function secToClock(sec){
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}
function toRomaji(kanaSeq){
  // kanaSeq: e.g. "から" -> "kara"
  const map = Object.fromEntries(KANA);
  // reverse map: kana -> romaji
  // KANA is [kana, romaji], so mapKanaRomaji[kana] = romaji
  let out = "";
  for(const ch of kanaSeq){ out += map[ch] || ch; }
  return out;
}
function toHiragana(romajiSeq){
  // romajiSeq here luôn là chuỗi các âm cơ bản đã chuẩn (ka/shi/tsu...) khi mình ghép từ bank
  // ta sẽ convert bằng cách cắt theo từ điển romaji->kana đơn giản
  const mapR2K = Object.fromEntries(KANA.map(([k,r])=>[r,k]));
  let out = "";
  // greedy match các âm dài nhất trước (3 ký tự: chi, shi, tsu / 2 ký tự / 1 ký tự)
  let i = 0;
  const s = romajiSeq.toLowerCase();
  while(i < s.length){
    let seg = null;
    if(i+3 <= s.length && mapR2K[s.slice(i,i+3)]) { seg = s.slice(i,i+3); i+=3; }
    else if(i+2 <= s.length && mapR2K[s.slice(i,i+2)]) { seg = s.slice(i,i+2); i+=2; }
    else if(mapR2K[s[i]]) { seg = s[i]; i+=1; }
    else { // ký tự lạ: đưa thẳng
      out += s[i];
      i+=1;
      continue;
    }
    out += mapR2K[seg];
  }
  return out;
}
function genSeq(bank, len, rng){
  // trả về {kanaSeq, romaSeq} với len ký tự (từ bank)
  const picks = pickN(bank, len, rng);
  const kanaSeq = picks.map(p=>p[0]).join("");
  const romaSeq = picks.map(p=>p[1]).join("");
  return {kanaSeq, romaSeq};
}

// ===== Progress =====
function updateProgress(){
  const total = QuizState.total;
  const answered = countAnswered();
  QuizState.answered = answered;
  const pct = total ? Math.round(100 * answered / total) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${answered}/${total}`;
}
function countAnswered(){
  let n = 0;
  document.querySelectorAll(".qcard").forEach(card=>{
    if(card.querySelector('input[type="radio"]')){
      const picked = card.querySelector('input[type="radio"]:checked');
      if(picked) n++;
    } else {
      const inp = card.querySelector("input.fill");
      if(inp && normalize(inp.value)) n++;
    }
  });
  return n;
}

// ===== Timer =====
function startTimer(seconds){
  stopTimer();
  QuizState.timerSec = seconds;
  if(seconds <= 0){ timerEl.textContent = "--:--"; return; }
  timerEl.textContent = secToClock(QuizState.timerSec);
  QuizState.tick = setInterval(()=>{
    if(QuizState.timerSec <= 0){
      stopTimer();
      if(!QuizState.locked){
        QuizState.locked = true;
        lockQuizUI(true);
        checkAnswers(true); // auto
        timerEl.textContent = "0:00";
      }
      return;
    }
    QuizState.timerSec--;
    timerEl.textContent = secToClock(QuizState.timerSec);
  }, 1000);
}
function stopTimer(){ if(QuizState.tick){ clearInterval(QuizState.tick); QuizState.tick = null; } }
function lockQuizUI(lock){
  const inputs = quizEl.querySelectorAll("input");
  inputs.forEach(i => i.disabled = lock);
  checkBtn.disabled = lock;
}

// ===== Quiz Generation =====
function parseSeqLen(val, rng){
  if(val === "1-3"){
    const pool = [1,2,3];
    return pool[Math.floor(rng()*pool.length)];
  }
  return Math.max(1, Math.min(4, parseInt(val,10)||1));
}

function generateQuiz(fromWrongList=null){
  const mode = $("#mode").value;                 // h2r | r2h | mix
  const qcount = parseInt($("#qcount").value, 10);
  const qtype = $("#qtype").value;               // mc | fill
  const includeWo = $("#includeWo").value === "yes";
  const timeLimit = parseInt($("#timeLimit").value, 10);
  const seqLenVal = $("#seqLen").value;          // "1","2","3","4","1-3"
  const seedVal = parseInt($("#seed").value || Date.now(), 10);
  const rng = seededRandom(seedVal);

  const bank = makeBank(includeWo);
  QuizState.bank = bank;
  QuizState.seed = seedVal;
  QuizState.locked = false;

  let picked;
  if(fromWrongList && fromWrongList.length){
    // đã là object sẵn {kanaSeq, romaSeq, askH2R}
    picked = fromWrongList;
  } else {
    picked = Array.from({length:qcount}).map((_,i)=>{
      const len = parseSeqLen(seqLenVal, rng);
      const {kanaSeq, romaSeq} = genSeq(bank, len, rng);
      const askH2R = mode==="h2r" ? true : mode==="r2h" ? false : (rng()<0.5);
      return { kanaSeq, romaSeq, askH2R };
    });
  }

  QuizState.items = picked;
  QuizState.startTime = Date.now();
  QuizState.endTime = null;

  // UI reset
  quizEl.innerHTML = "";
  actions.style.display = "flex";
  metaBar.style.display = "block";
  checkWrap.style.display = "block";
  resultBox.style.display = "none";
  retryBtn.style.display = "none";
  exportBtn.style.display = "none";
  scoreEl.textContent = "0";
  progressBar.style.width = "0%";
  progressText.textContent = "0/0";

  // Render questions
  picked.forEach((item, idx) => {
    const {kanaSeq, romaSeq, askH2R} = item;
    const question = askH2R ? kanaSeq : romaSeq;
    const correct = askH2R ? romaSeq : kanaSeq;

    const card = document.createElement("div");
    card.className = "qcard";
    card.dataset.correct = correct;
    card.dataset.kanaSeq = kanaSeq;
    card.dataset.romaSeq = romaSeq;
    card.dataset.ask = askH2R ? "h2r" : "r2h";

    const head = document.createElement("div");
    head.className = "qhead";
    head.innerHTML = `<div class="qno">Câu ${idx+1}</div>
                      <div class="prompt">${question}</div>`;
    card.appendChild(head);

    if(qtype === "mc"){
      const choicesWrap = document.createElement("div");
      choicesWrap.className = "choices";

      const needH2R = askH2R; // nếu hỏi hira→roma, đáp án là romaji; r2h thì đáp án là kana
      const len = kanaSeq.length; // độ dài chuỗi theo số ký tự kana (romaji có độ dài khác, nhưng distractors sẽ sinh theo cùng số âm)

      const rngLocal = seededRandom(QuizState.seed + idx * 97 + 13);
      const optSet = new Set([correct]);
      const options = [correct];

      let guard = 0;
      while(options.length < 4 && guard < 200){
        guard++;
        const l = kanaSeq.length; // sinh distractor với số âm giống nhau
        const {kanaSeq: k2, romaSeq: r2} = genSeq(QuizState.bank, l, rngLocal);
        const cand = needH2R ? r2 : k2;
        if(!optSet.has(cand)){
          options.push(cand);
          optSet.add(cand);
        }
      }

      shuffle(options, rngLocal).forEach((opt, oi) => {
        const id = `q${idx}_o${oi}`;
        const row = document.createElement("label");
        row.className = "choice";
        row.innerHTML = `<input type="radio" name="q${idx}" value="${opt}" id="${id}"><span>${opt}</span>`;
        row.querySelector("input").addEventListener("change", updateProgress);
        choicesWrap.appendChild(row);
      });

      card.appendChild(choicesWrap);
    } else {
      const input = document.createElement("input");
      input.className = "fill";
      input.setAttribute("autocomplete","off");
      input.setAttribute("placeholder", askH2R ? "Điền romaji (vd: shita)" : "Điền hiragana (vd: した)");
      input.addEventListener("input", () => {
        if(!input._raf){
          input._raf = true;
          requestAnimationFrame(()=>{ input._raf=false; updateProgress(); });
        }
      });
      card.appendChild(input);
    }

    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "Xem đáp án";
    const ans = document.createElement("div");
    ans.className = "answer";
    ans.textContent = `Đáp án: ${correct}`;
    det.appendChild(sum);
    det.appendChild(ans);
    card.appendChild(det);

    const tip = document.createElement("div");
    tip.className = "explain";
    tip.textContent = askH2R
      ? "Gợi ý: đọc liền mạch chuỗi kana rồi chuyển sang romaji."
      : "Gợi ý: chuyển từng âm romaji sang kana, rồi ghép lại.";
    card.appendChild(tip);

    quizEl.appendChild(card);
  });

  QuizState.total = picked.length;
  updateProgress();

  // Timer
  startTimer(timeLimit);

  // mở đầu trang
  window.scrollTo({top:0, behavior:"smooth"});
}

// ===== Check & Report =====
function checkAnswers(auto=false){
  if(QuizState.locked && !auto) return;

  const cards = [...document.querySelectorAll(".qcard")];
  if(!cards.length) return;

  let correctCount = 0, wrongCount = 0, emptyCount = 0;
  let bestStreak = 0, curStreak = 0, revealedCount = 0;

  const rowsForExport = [];

  cards.forEach((card, idx) => {
    const correct = card.dataset.correct;
    const ask = card.dataset.ask;
    const kanaSeq = card.dataset.kanaSeq;
    const romaSeq = card.dataset.romaSeq;

    const radios = card.querySelectorAll('input[type="radio"]');
    let userAns = "";
    if(radios.length){
      const picked = [...radios].find(r => r.checked);
      userAns = picked ? picked.value : "";
    } else {
      const inp = card.querySelector("input.fill");
      userAns = inp ? inp.value : "";
    }

    const revealed = !!card.querySelector("details[open]");
    if(revealed) revealedCount++;

    let isRight = normalize(userAns) === normalize(correct);
    if(!userAns){ emptyCount++; isRight = false; }

    if(isRight){
      card.classList.remove("wrong");
      card.classList.add("correct");
      correctCount++;
      curStreak++;
      if(curStreak>bestStreak) bestStreak = curStreak;
    } else {
      card.classList.remove("correct");
      card.classList.add("wrong");
      wrongCount++;
      curStreak = 0;
    }

    rowsForExport.push({
      no: idx+1,
      mode: ask==="h2r" ? "Hira→Roma" : "Roma→Hira",
      prompt: ask==="h2r" ? kanaSeq : romaSeq,
      your: userAns || "(bỏ trống)",
      correct
    });
  });

  if(!QuizState.endTime) QuizState.endTime = Date.now();
  stopTimer();
  QuizState.locked = true;
  lockQuizUI(true);

  const duration = QuizState.endTime - QuizState.startTime;
  const perQ = duration / cards.length;

  scoreEl.textContent = `${correctCount}/${cards.length} (${Math.round(100*correctCount/cards.length)}%)`;

  const penaltyNote = revealedCount>0
    ? `<span class="warn">Bạn đã mở đáp án ở ${revealedCount} câu trước khi nộp.</span>`
    : `<span class="ok">Bạn không mở đáp án trước khi nộp. Good!</span>`;

  resultBox.innerHTML = `
    <h3>Kết quả bài làm</h3>
    ${penaltyNote}
    <div class="kv">
      <div class="item"><div class="label">Số câu đúng</div><div class="value">${correctCount}</div></div>
      <div class="item"><div class="label">Số câu sai</div><div class="value">${wrongCount}</div></div>
      <div class="item"><div class="label">Bỏ trống</div><div class="value">${emptyCount}</div></div>
      <div class="item"><div class="label">% chính xác</div><div class="value">${Math.round(100*correctCount/cards.length)}%</div></div>
      <div class="item"><div class="label">Thời gian</div><div class="value">${msToClock(duration)}</div></div>
      <div class="item"><div class="label">Tốc độ TB/câu</div><div class="value">${(perQ/1000).toFixed(1)}s</div></div>
      <div class="item"><div class="label">Streak đúng dài nhất</div><div class="value">${bestStreak}</div></div>
      <div class="item"><div class="label">Seed</div><div class="value">${QuizState.seed}</div></div>
    </div>
  `;
  resultBox.style.display = "block";

  retryBtn.style.display = (wrongCount>0 || emptyCount>0) ? "inline-block" : "none";
  exportBtn.style.display = "inline-block";

  QuizState.lastExport = {
    score: `${correctCount}/${cards.length}`,
    percent: Math.round(100*correctCount/cards.length),
    duration: msToClock(duration),
    perQ: (perQ/1000).toFixed(1)+"s",
    bestStreak,
    revealedCount,
    rows: rowsForExport
  };

  resultBox.scrollIntoView({behavior:"smooth", block:"center"});
}

function revealAll(){ document.querySelectorAll(".qcard details").forEach(d => d.open = true); }

// ===== Retry wrong only =====
function retryWrong(){
  const wrongCards = [...document.querySelectorAll(".qcard.wrong, .qcard:not(.correct):not(.wrong)")];
  if(!wrongCards.length) return;

  const wrongItems = wrongCards.map(card => {
    const ask = card.dataset.ask === "h2r";
    return {
      kanaSeq: card.dataset.kanaSeq,
      romaSeq: card.dataset.romaSeq,
      askH2R: ask
    };
  });

  QuizState.locked = false;
  lockQuizUI(false);
  generateQuiz(wrongItems);
  window.scrollTo({top:0, behavior:"smooth"});
}

// ===== Export TXT =====
function exportResult(){
  if(!QuizState.lastExport) return;
  const ex = QuizState.lastExport;
  const lines = [];
  lines.push("== HIRAGANA QUIZ RESULT ==");
  lines.push(`Score: ${ex.score} (${ex.percent}%)`);
  lines.push(`Time: ${ex.duration} | Avg/Q: ${ex.perQ} | Best Streak: ${ex.bestStreak}`);
  lines.push(`Revealed before submit: ${ex.revealedCount}`);
  lines.push(`Seed: ${QuizState.seed}`);
  lines.push("");
  lines.push("No | Mode        | Prompt | Your Answer | Correct");
  lines.push("-- | ----------- | ------ | ----------- | -------");
  ex.rows.forEach(r=>{
    lines.push(
      String(r.no).padEnd(2," ")+" | "+
      r.mode.padEnd(11," ")+" | "+
      r.prompt+" | "+
      r.your+" | "+
      r.correct
    );
  });

  const blob = new Blob([lines.join("\n")], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hiragana-quiz-result-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===== Bindings =====
document.addEventListener("DOMContentLoaded", () => {
  $("#gen").addEventListener("click", () => generateQuiz());
  $("#revealAll").addEventListener("click", revealAll);
  $("#reset").addEventListener("click", () => {
    QuizState.locked = false;
    lockQuizUI(false);
    generateQuiz();
  });
  $("#check").addEventListener("click", () => checkAnswers(false));
  $("#retryWrong").addEventListener("click", retryWrong);
  $("#exportResult").addEventListener("click", exportResult);

  // đề mặc định
  generateQuiz();
});
