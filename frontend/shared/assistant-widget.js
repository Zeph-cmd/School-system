/**
 * AI Assistant Chat Widget — shared by admin / teacher / parent panels.
 *
 * Talks to POST /api/assistant. The user's role is determined by the backend
 * from the JWT — this widget sends ONLY { message }. No API key, no role here.
 */
(function () {
  let token = null;
  try { token = localStorage.getItem('token'); } catch (e) {}
  if (!token) return; // not logged in — don't render anything

  let role = null;
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const roles = Array.isArray(user.roles) ? user.roles : [];
    role = ['admin', 'teacher', 'parent'].find((r) => roles.includes(r)) || null;
  } catch (e) {}
  if (!role) return;

  const STARTERS = {
    admin: [
      'How do I unlock grades?',
      'How do I promote a student to the next class?',
      'How do I view a class roster by term?',
    ],
    teacher: [
      'How do I view my classes?',
      'How do I mark attendance?',
      'How do I message a parent?',
    ],
    parent: [
      'How do I add another child?',
      "How do I check my child's fees?",
      'How do I contact a teacher?',
    ],
  };

  const LIMIT_MESSAGE = 'Daily limit reached, try again tomorrow.';
  const GENERIC_ERROR = 'Something went wrong, try again';
  const WAKE_MESSAGE = 'Waking up the server, please wait...';

  // ── Build DOM ─────────────────────────────────────
  const fab = document.createElement('button');
  fab.className = 'assist-fab';
  fab.setAttribute('aria-label', 'Open App Assistant');
  fab.innerHTML = '<span class="assist-fab-bot">&#129302;</span><span class="assist-fab-close">&#10005;</span>';

  const win = document.createElement('div');
  win.className = 'assist-window';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'App Assistant');
  win.innerHTML = `
    <div class="assist-header">
      <span>&#129302;</span>
      <div>
        <div class="assist-title">App Assistant</div>
        <div class="assist-sub">How can I help you today?</div>
      </div>
    </div>
    <div class="assist-messages"></div>
    <div class="assist-starters"></div>
    <div class="assist-input-row">
      <input type="text" maxlength="500" placeholder="Ask about the app...">
      <button type="button">Send</button>
    </div>
  `;

  const messagesEl = win.querySelector('.assist-messages');
  const startersEl = win.querySelector('.assist-starters');
  const inputEl = win.querySelector('input');
  const sendBtn = win.querySelector('.assist-input-row button');

  document.body.appendChild(fab);
  document.body.appendChild(win);

  // ── Helpers ───────────────────────────────────────
  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(text, className) {
    const b = document.createElement('div');
    b.className = 'assist-bubble ' + className;
    // textContent — never innerHTML with dynamic content (XSS-safe)
    b.textContent = text;
    messagesEl.appendChild(b);
    scrollBottom();
    return b;
  }

  function addStarters() {
    startersEl.innerHTML = '';
    STARTERS[role].forEach((q) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = q;
      btn.addEventListener('click', () => send(q));
      startersEl.appendChild(btn);
    });
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    inputEl.disabled = busy;
  }

  function open() {
    win.classList.add('open');
    fab.classList.add('open');
    if (!messagesEl.childElementCount) {
      addBubble(
        'Hi! I can explain how this ' + role + ' panel works. Pick a question below or type your own.',
        'bot'
      );
      addStarters();
    }
    inputEl.focus();
  }

  function close() {
    win.classList.remove('open');
    fab.classList.remove('open');
  }

  fab.addEventListener('click', () => {
    win.classList.contains('open') ? close() : open();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && win.classList.contains('open')) close();
  });

  async function send(text) {
    const message = (text || inputEl.value || '').trim().slice(0, 500);
    if (!message) return;
    inputEl.value = '';
    addBubble(message, 'user');
    startersEl.innerHTML = '';

    const typing = addBubble('Typing...', 'bot typing');
    setBusy(true);

    // Wake-up notice after 8s (Render free instance can sleep)
    const wakeTimer = setTimeout(() => {
      typing.textContent = WAKE_MESSAGE;
    }, 8000);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ message }),
      });

      clearTimeout(wakeTimer);

      if (res.status === 429) {
        typing.className = 'assist-bubble error';
        typing.textContent = LIMIT_MESSAGE;
      } else if (!res.ok) {
        typing.className = 'assist-bubble error';
        typing.textContent = GENERIC_ERROR;
      } else {
        const data = await res.json();
        typing.className = 'assist-bubble bot';
        typing.textContent = (data && data.reply) ? data.reply : GENERIC_ERROR;
        // Fresh starters after each answered question
        addStarters();
      }
    } catch (err) {
      clearTimeout(wakeTimer);
      typing.className = 'assist-bubble error';
      typing.textContent = GENERIC_ERROR;
    } finally {
      setBusy(false);
      scrollBottom();
    }
  }

  sendBtn.addEventListener('click', () => send());
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
})();
