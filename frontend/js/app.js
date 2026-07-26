/* ============================================================
   APP.JS
   JARVIS desktop companion — application logic.

   Organized into independent modules on top of a shared
   element cache. Each module owns one responsibility and
   exposes only what other modules need. The `Assistant`
   module at the bottom is the single integration seam for a
   real backend: replace its two request functions with actual
   network calls and every other module continues to work
   unmodified.
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     ELEMENT CACHE
     Every DOM lookup happens once, here, at startup.
     ========================================================== */
  const dom = {
    reactor: document.getElementById('reactor'),
    reactorStage: document.getElementById('reactorStage'),
    reactorCaption: document.getElementById('reactorCaption'),
    statusDot: document.getElementById('statusDot'),
    statusLabel: document.getElementById('statusLabel'),

    greeting: document.getElementById('greeting'),
    dateText: document.getElementById('dateText'),
    weatherText: document.getElementById('weatherText'),

    messages: document.getElementById('messages'),

    composerForm: document.getElementById('composerForm'),
    composerField: document.getElementById('composerField'),
    composerHint: document.getElementById('composerHint'),
    micButton: document.getElementById('micButton'),
    sendButton: document.getElementById('sendButton'),
  };

  /* ==========================================================
     REACTOR MODULE
     Owns the assistant's visible state machine: idle,
     listening, thinking, speaking, offline, error. This is the
     single source of truth other modules call into whenever
     the assistant's activity changes.
     ========================================================== */
  const Reactor = (function () {
    const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking', 'offline', 'error'];

    const STATE_COPY = {
      idle: { caption: 'Listening', status: 'Online' },
      listening: { caption: 'Listening', status: 'Listening' },
      thinking: { caption: 'Thinking', status: 'Thinking' },
      speaking: { caption: 'Speaking', status: 'Speaking' },
      offline: { caption: 'Offline', status: 'Offline' },
      error: { caption: 'Something went wrong', status: 'Error' },
    };

    let current = 'idle';
    let revertTimer = null;

    function setState(nextState, options) {
      options = options || {};

      if (VALID_STATES.indexOf(nextState) === -1) {
        console.warn('Reactor.setState: unknown state "' + nextState + '"');
        return;
      }

      current = nextState;
      dom.reactor.dataset.state = nextState;
      dom.reactor.setAttribute('aria-label', 'Assistant status: ' + nextState);

      const copy = STATE_COPY[nextState];
      dom.reactorCaption.textContent = copy.caption;
      dom.statusLabel.textContent = copy.status;
      dom.reactorStage.dataset.showCaption = options.showCaption ? 'true' : 'false';

      if (revertTimer) {
        clearTimeout(revertTimer);
        revertTimer = null;
      }

      // Transient states (thinking / speaking / error) can be given
      // a duration after which the reactor automatically returns to
      // idle — useful for simulated or fire-and-forget responses.
      if (typeof options.revertToIdleAfter === 'number') {
        revertTimer = setTimeout(function () {
          setState('idle');
        }, options.revertToIdleAfter);
      }
    }

    function getState() {
      return current;
    }

    return {
      setState: setState,
      getState: getState,
    };
  })();

  /* ==========================================================
     CONTEXT MODULE
     Greeting, date and weather shown beneath the reactor.
     Weather is exposed as `updateWeather(data)` so a future
     backend integration only needs to call it with fresh data.
     ========================================================== */
  const Context = (function () {
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    function updateGreeting() {
      const hour = new Date().getHours();
      let greeting;

      if (hour < 5) {
        greeting = 'Still up, Sir';
      } else if (hour < 12) {
        greeting = 'Good morning';
      } else if (hour < 17) {
        greeting = 'Good afternoon';
      } else if (hour < 22) {
        greeting = 'Good evening';
      } else {
        greeting = 'Good night';
      }

      dom.greeting.textContent = greeting;
    }

    function updateDate() {
      const now = new Date();
      const label = WEEKDAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate();
      dom.dateText.textContent = label;
    }

    // Accepts { temperature: number, unit: 'C' | 'F', condition: string }.
    // Called by whatever data source is wired up later (geolocation +
    // a weather API, a smart-home bridge, etc). Left as the sole entry
    // point so no other module needs to know where weather comes from.
    function updateWeather(data) {
      if (!data || typeof data.temperature !== 'number') {
        dom.weatherText.textContent = 'Weather unavailable';
        return;
      }

      const unit = data.unit === 'F' ? 'F' : 'C';
      dom.weatherText.textContent = Math.round(data.temperature) + '\u00B0' + unit;
    }

    function init() {
      updateGreeting();
      updateDate();

      // Greeting and date drift over real time; refresh once a minute
      // rather than reconstructing Date() on every render elsewhere.
      setInterval(updateGreeting, 60 * 1000);
      setInterval(updateDate, 60 * 1000);
    }

    return {
      init: init,
      updateGreeting: updateGreeting,
      updateDate: updateDate,
      updateWeather: updateWeather,
    };
  })();

  /* ==========================================================
     CONVERSATION MODULE
     Renders messages into the transcript and manages scroll
     position and the transient typing indicator.
     ========================================================== */
  const Conversation = (function () {
    let typingRow = null;

    function formatTime(date) {
      let hours = date.getHours();
      const minutes = date.getMinutes();
      const suffix = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const paddedMinutes = minutes < 10 ? '0' + minutes : String(minutes);
      return hours + ':' + paddedMinutes + ' ' + suffix;
    }

    function scrollToBottom() {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    }

    // role: 'user' | 'assistant' | 'system'
    function appendMessage(role, text, options) {
      options = options || {};
      const timestamp = options.timestamp || new Date();

      const row = document.createElement('div');
      row.className = 'message message--' + role;

      if (role !== 'system') {
        const meta = document.createElement('div');
        meta.className = 'message-meta';

        const author = document.createElement('span');
        author.className = 'message-author';
        author.textContent = role === 'user' ? 'You' : 'Jarvis';

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = formatTime(timestamp);

        meta.appendChild(author);
        meta.appendChild(time);
        row.appendChild(meta);
      }

      const body = document.createElement('div');
      body.className = 'message-body';
      body.textContent = text;
      row.appendChild(body);

      dom.messages.appendChild(row);
      scrollToBottom();

      return row;
    }

    function showTyping() {
      if (typingRow) return;

      typingRow = document.createElement('div');
      typingRow.className = 'message message--assistant';

      const indicator = document.createElement('div');
      indicator.className = 'typing-indicator';
      indicator.innerHTML = '<span></span><span></span><span></span>';

      typingRow.appendChild(indicator);
      dom.messages.appendChild(typingRow);
      scrollToBottom();
    }

    function hideTyping() {
      if (!typingRow) return;
      typingRow.remove();
      typingRow = null;
    }

    return {
      appendMessage: appendMessage,
      showTyping: showTyping,
      hideTyping: hideTyping,
      scrollToBottom: scrollToBottom,
    };
  })();

  /* ==========================================================
     COMPOSER MODULE
     Text field growth, send-button enablement, and dispatching
     submitted messages to the Assistant module.
     ========================================================== */
  const Composer = (function () {
    const MAX_FIELD_HEIGHT = 132;

    function autoGrow() {
      dom.composerField.style.height = 'auto';
      const nextHeight = Math.min(dom.composerField.scrollHeight, MAX_FIELD_HEIGHT);
      dom.composerField.style.height = nextHeight + 'px';
    }

    function refreshSendState() {
      const hasText = dom.composerField.value.trim().length > 0;
      dom.sendButton.disabled = !hasText;
      dom.sendButton.dataset.ready = hasText ? 'true' : 'false';
    }

    function clear() {
      dom.composerField.value = '';
      autoGrow();
      refreshSendState();
    }

    function handleSubmit(event) {
      event.preventDefault();
      const text = dom.composerField.value.trim();
      if (!text) return;

      Assistant.sendMessage(text);
      clear();
      dom.composerField.focus();
    }

    function handleKeydown(event) {
      // Enter sends; Shift+Enter inserts a newline.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        dom.composerForm.requestSubmit();
      }
    }

    function init() {
      dom.composerForm.addEventListener('submit', handleSubmit);
      dom.composerField.addEventListener('input', function () {
        autoGrow();
        refreshSendState();
      });
      dom.composerField.addEventListener('keydown', handleKeydown);

      dom.composerField.addEventListener('focus', function () {
        dom.composerHint.style.opacity = '0.4';
      });
      dom.composerField.addEventListener('blur', function () {
        dom.composerHint.style.opacity = '1';
      });

      refreshSendState();
    }

    return {
      init: init,
      clear: clear,
    };
  })();

  /* ==========================================================
     VOICE MODULE
     Owns the microphone button and the listening state. Wraps
     the Web Speech API when available and degrades to a manual
     toggle (useful for testing, or platforms without speech
     recognition support) when it is not.
     ========================================================== */
  const Voice = (function () {
    let recognition = null;
    let isListening = false;

    function supportsSpeechRecognition() {
      return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    }

    function createRecognizer() {
      const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const instance = new RecognitionCtor();
      instance.continuous = false;
      instance.interimResults = false;
      instance.lang = 'en-US';

      instance.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        if (transcript && transcript.trim()) {
          Assistant.sendMessage(transcript.trim());
        }
      };

      instance.onerror = function () {
        stopListening();
        Reactor.setState('error', { revertToIdleAfter: 1800 });
      };

      instance.onend = function () {
        stopListening();
      };

      return instance;
    }

    function startListening() {
      if (isListening) return;
      isListening = true;

      dom.micButton.dataset.active = 'true';
      dom.micButton.setAttribute('aria-pressed', 'true');
      Reactor.setState('listening', { showCaption: true });

      if (supportsSpeechRecognition()) {
        recognition = recognition || createRecognizer();
        try {
          recognition.start();
        } catch (err) {
          // start() throws if called while already active; safe to ignore.
        }
      }
    }

    function stopListening() {
      if (!isListening) return;
      isListening = false;

      dom.micButton.dataset.active = 'false';
      dom.micButton.setAttribute('aria-pressed', 'false');

      if (recognition) {
        try {
          recognition.stop();
        } catch (err) {
          // stop() throws if not active; safe to ignore.
        }
      }

      if (Reactor.getState() === 'listening') {
        Reactor.setState('idle');
      }
    }

    function toggle() {
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    }

    function init() {
      dom.micButton.addEventListener('click', toggle);
    }

    return {
      init: init,
      startListening: startListening,
      stopListening: stopListening,
    };
  })();

  /* ==========================================================
     ASSISTANT MODULE
     The integration seam for a real backend. `sendMessage` is
     called by both the composer and voice input; it drives the
     reactor through listening → thinking → speaking and renders
     both sides of the exchange. `requestResponse` is the single
     function to replace with an actual network call (e.g. a
     fetch to a local inference server or a hosted API) — its
     contract (a string in, a Promise<string> out) is designed
     to make that swap a one-function change.
     ========================================================== */
  const Assistant = (function () {
    function sendMessage(text) {
      Conversation.appendMessage('user', text);
      Reactor.setState('thinking');
      Conversation.showTyping();

      requestResponse(text)
        .then(function (replyText) {
          Conversation.hideTyping();
          receiveMessage(replyText);
        })
        .catch(function () {
          Conversation.hideTyping();
          Reactor.setState('error', { revertToIdleAfter: 2000 });
          Conversation.appendMessage(
            'system',
            'Connection interrupted — the response could not be completed.'
          );
        });
    }

    function receiveMessage(text) {
      Reactor.setState('speaking');
      Conversation.appendMessage('assistant', text);

      // Return to idle once the "speaking" moment has had time to read.
      const estimatedReadTime = Math.min(4200, 1200 + text.length * 18);
      Reactor.setState('speaking', { revertToIdleAfter: estimatedReadTime });
    }

    // Placeholder response generator. Replace this function's body
    // with a real network call — for example:
    //
    //   function requestResponse(text) {
    //     return fetch('/api/assistant', {
    //       method: 'POST',
    //       headers: { 'Content-Type': 'application/json' },
    //       body: JSON.stringify({ message: text }),
    //     })
    //       .then((res) => res.json())
    //       .then((data) => data.reply);
    //   }
    //
    // Every caller already treats this as asynchronous, so no other
    // module needs to change when the real integration lands.
    function requestResponse(text) {
      return new Promise(function (resolve) {
        const thinkingDelay = 650 + Math.random() * 700;
        setTimeout(function () {
          resolve(
            'I received your message: "' + text + '". Backend integration is not yet connected.'
          );
        }, thinkingDelay);
      });
    }

    return {
      sendMessage: sendMessage,
      receiveMessage: receiveMessage,
    };
  })();

  /* ==========================================================
     BOOTSTRAP
     ========================================================== */
  function init() {
    Context.init();
    Composer.init();
    Voice.init();

    Conversation.appendMessage(
      'system',
      'Session started'
    );
    Conversation.appendMessage(
      'assistant',
      'Good to see you. What can I help with?'
    );

    // Example of a future weather integration call:
    // Context.updateWeather({ temperature: 21, unit: 'C', condition: 'clear' });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
