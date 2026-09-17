/* =============================================================================
   My Homepage — 달력 & 일정
   일정은 브라우저 localStorage에 저장됩니다.
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_EVENTS = "homepage.events.v1";
  var STORAGE_THEME = "homepage.theme.v1";
  var WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

  /* ---------------------------------------------------------------------------
     저장소 (localStorage 접근은 실패할 수 있으므로 항상 감싼다)
     ------------------------------------------------------------------------ */
  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* 저장 실패(시크릿 모드 등)해도 화면 동작은 유지한다 */
    }
  }

  /* ---------------------------------------------------------------------------
     날짜 유틸
     ------------------------------------------------------------------------ */
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function fromKey(key) {
    var parts = key.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  function formatKorean(key) {
    var d = fromKey(key);
    return (
      d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" +
      WEEKDAY_NAMES[d.getDay()] + ")"
    );
  }

  function formatShort(key) {
    var d = fromKey(key);
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + WEEKDAY_NAMES[d.getDay()] + ")";
  }

  /* ---------------------------------------------------------------------------
     상태
     ------------------------------------------------------------------------ */
  var events = readStore(STORAGE_EVENTS, {}) || {};
  var today = startOfDay(new Date());
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth();
  var selectedKey = toKey(today);

  /* ---------------------------------------------------------------------------
     DOM 참조
     ------------------------------------------------------------------------ */
  var grid = document.getElementById("calendar-grid");
  var titleEl = document.getElementById("calendar-title");
  var eventsTitle = document.getElementById("events-title");
  var eventsSubtitle = document.getElementById("events-subtitle");
  var eventList = document.getElementById("event-list");
  var eventEmpty = document.getElementById("event-empty");
  var eventForm = document.getElementById("event-form");
  var eventTitleInput = document.getElementById("event-title");
  var hourSelect = document.getElementById("event-hour");
  var minuteSelect = document.getElementById("event-minute");
  var upcomingList = document.getElementById("upcoming-list");
  var upcomingEmpty = document.getElementById("upcoming-empty");

  /* ---------------------------------------------------------------------------
     일정 데이터
     ------------------------------------------------------------------------ */
  function eventsOn(key) {
    var list = events[key];
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) {
      if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });
  }

  function addEvent(key, title, time) {
    if (!Array.isArray(events[key])) events[key] = [];
    events[key].push({
      id: "e" + Date.now() + Math.random().toString(36).slice(2, 7),
      title: title,
      time: time || ""
    });
    writeStore(STORAGE_EVENTS, events);
  }

  function removeEvent(key, id) {
    if (!Array.isArray(events[key])) return;
    events[key] = events[key].filter(function (item) {
      return item.id !== id;
    });
    if (events[key].length === 0) delete events[key];
    writeStore(STORAGE_EVENTS, events);
  }

  /* ---------------------------------------------------------------------------
     달력 그리기
     ------------------------------------------------------------------------ */
  function renderCalendar() {
    titleEl.textContent = viewYear + "년 " + (viewMonth + 1) + "월";
    grid.textContent = "";

    var firstOfMonth = new Date(viewYear, viewMonth, 1);
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var leading = firstOfMonth.getDay();               // 1일 앞의 빈 칸 수
    var totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

    var cursor = new Date(viewYear, viewMonth, 1 - leading);
    var todayKey = toKey(today);
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < totalCells; i++) {
      var date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i);
      fragment.appendChild(buildDayCell(date, todayKey));
    }

    grid.appendChild(fragment);
  }

  function buildDayCell(date, todayKey) {
    var key = toKey(date);
    var dayEvents = eventsOn(key);
    var isOutside = date.getMonth() !== viewMonth;

    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day";
    cell.dataset.date = key;
    cell.setAttribute("role", "gridcell");

    if (isOutside) cell.classList.add("is-outside");
    if (date.getDay() === 0) cell.classList.add("is-sun");
    if (date.getDay() === 6) cell.classList.add("is-sat");
    if (key === todayKey) cell.classList.add("is-today");
    if (key === selectedKey) {
      cell.classList.add("is-selected");
      cell.setAttribute("aria-current", "date");
    }

    var label = formatKorean(key);
    if (key === todayKey) label += ", 오늘";
    if (dayEvents.length) label += ", 일정 " + dayEvents.length + "개";
    cell.setAttribute("aria-label", label);

    var num = document.createElement("span");
    num.className = "day-num";
    num.textContent = String(date.getDate());
    cell.appendChild(num);

    // 그날의 일정을 칸 안에 전부 표시한다 (자르지 않고 줄바꿈)
    if (dayEvents.length) {
      var list = document.createElement("span");
      list.className = "day-events";
      dayEvents.forEach(function (item) {
        var chip = document.createElement("span");
        chip.className = "day-event";
        chip.textContent = item.time ? item.time + " " + item.title : item.title;
        list.appendChild(chip);
      });
      cell.appendChild(list);
    }

    return cell;
  }

  /* ---------------------------------------------------------------------------
     선택한 날짜의 일정 패널
     ------------------------------------------------------------------------ */
  function renderEventPanel() {
    var list = eventsOn(selectedKey);

    eventsTitle.textContent = formatKorean(selectedKey);
    var diff = daysBetween(today, fromKey(selectedKey));
    eventsSubtitle.textContent =
      diff === 0 ? "오늘" : diff > 0 ? diff + "일 남음" : Math.abs(diff) + "일 지남";

    eventList.textContent = "";
    eventEmpty.hidden = list.length > 0;

    list.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "event-item";

      if (item.time) {
        var time = document.createElement("span");
        time.className = "event-time";
        time.textContent = item.time;
        li.appendChild(time);
      }

      var name = document.createElement("span");
      name.className = "event-name";
      name.textContent = item.title;
      li.appendChild(name);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "event-delete";
      del.textContent = "×";
      del.setAttribute("aria-label", item.title + " 일정 삭제");
      del.addEventListener("click", function () {
        removeEvent(selectedKey, item.id);
        render();
      });
      li.appendChild(del);

      eventList.appendChild(li);
    });
  }

  /* ---------------------------------------------------------------------------
     다가오는 일정
     ------------------------------------------------------------------------ */
  function renderUpcoming() {
    var rows = [];

    Object.keys(events).forEach(function (key) {
      if (daysBetween(today, fromKey(key)) < 0) return;   // 지난 일정 제외
      eventsOn(key).forEach(function (item) {
        rows.push({ key: key, item: item });
      });
    });

    rows.sort(function (a, b) {
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return (a.item.time || "99:99") < (b.item.time || "99:99") ? -1 : 1;
    });

    rows = rows.slice(0, 5);

    upcomingList.textContent = "";
    upcomingEmpty.hidden = rows.length > 0;

    rows.forEach(function (row) {
      var diff = daysBetween(today, fromKey(row.key));

      var li = document.createElement("li");
      li.className = "upcoming-item";

      var date = document.createElement("span");
      date.className = "upcoming-date";
      date.textContent = formatShort(row.key);
      li.appendChild(date);

      var name = document.createElement("span");
      name.className = "upcoming-name";
      name.textContent = row.item.time ? row.item.time + " · " + row.item.title : row.item.title;
      li.appendChild(name);

      var dday = document.createElement("span");
      dday.className = "upcoming-dday";
      dday.textContent = diff === 0 ? "D-DAY" : "D-" + diff;
      li.appendChild(dday);

      upcomingList.appendChild(li);
    });
  }

  function render() {
    renderCalendar();
    renderEventPanel();
    renderUpcoming();
  }

  /* ---------------------------------------------------------------------------
     이벤트 바인딩
     ------------------------------------------------------------------------ */
  grid.addEventListener("click", function (e) {
    var cell = e.target.closest(".day");
    if (!cell) return;

    selectedKey = cell.dataset.date;
    var picked = fromKey(selectedKey);

    // 이전/다음 달 날짜를 누르면 해당 달로 이동
    if (picked.getMonth() !== viewMonth || picked.getFullYear() !== viewYear) {
      viewYear = picked.getFullYear();
      viewMonth = picked.getMonth();
    }

    render();
    eventTitleInput.focus();
  });

  document.getElementById("prev-month").addEventListener("click", function () {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
  });

  document.getElementById("next-month").addEventListener("click", function () {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
  });

  document.getElementById("today-btn").addEventListener("click", function () {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    selectedKey = toKey(today);
    render();
  });

  eventForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var title = eventTitleInput.value.trim();
    if (!title) return;

    addEvent(selectedKey, title, readTimePicker());
    eventTitleInput.value = "";
    resetTimePicker();
    render();
    eventTitleInput.focus();
  });

  /* ---------------------------------------------------------------------------
     시간 선택 (24시간제 시 · 분)
     ------------------------------------------------------------------------ */
  function addOption(select, value, label) {
    var opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }

  function buildTimePicker() {
    addOption(hourSelect, "", "시");
    for (var h = 0; h < 24; h++) addOption(hourSelect, String(h), pad(h) + "시");
    for (var m = 0; m < 60; m += 5) addOption(minuteSelect, String(m), pad(m) + "분");
  }

  /* 시를 고르지 않았으면 시간 없는 일정으로 취급한다 */
  function readTimePicker() {
    if (!hourSelect.value) return "";
    return pad(Number(hourSelect.value)) + ":" + pad(Number(minuteSelect.value));
  }

  function resetTimePicker() {
    hourSelect.value = "";
    minuteSelect.value = "0";
  }

  /* ---------------------------------------------------------------------------
     테마 전환
     ------------------------------------------------------------------------ */
  var themeToggle = document.getElementById("theme-toggle");
  var themeIcon = themeToggle.querySelector(".theme-icon");

  function prefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyTheme(theme) {
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    var dark = theme ? theme === "dark" : prefersDark();
    themeIcon.textContent = dark ? "☀️" : "🌙";
  }

  applyTheme(readStore(STORAGE_THEME, null));

  themeToggle.addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme");
    var isDark = current ? current === "dark" : prefersDark();
    var next = isDark ? "light" : "dark";
    applyTheme(next);
    writeStore(STORAGE_THEME, next);
  });

  /* ---------------------------------------------------------------------------
     모바일 메뉴 / 기타
     ------------------------------------------------------------------------ */
  var navToggle = document.getElementById("nav-toggle");
  var nav = document.querySelector(".nav");

  navToggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
  });

  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });

  document.getElementById("year").textContent = String(new Date().getFullYear());

  buildTimePicker();
  render();
})();
