var book = ePub();
var rendition;
var chapters = []
var epubSwipeEnabled = true; // Global flag to enable/disable swipe/page-turn
var clearSelectionOnPageChange = true; // Global flag for selection clearing behavior
var underlineStyles = {}; // Store underline styles by CFI for re-rendering
var underlineAnnotations = {}; // Store annotation objects by CFI for direct access
var isAddingUnderline = false; // Flag to prevent re-rendering during underline addition
var scrollListenerAttached = false; // Ensure scroll listener is only attached once
var scrollTarget = null; // Actual scrolling container (e.g., .epub-container)
var lastScrollTop = 0; // Last scrollTop for direction detection

var isScrolling = false;
var scrollTimeout;
var lastDirection = 'none';

var wavyAnnotations = {};
var currentFlow = 'paginated'; // Track current flow

let isSelecting = false;
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let isDragging = false;
let maxDeltaX = 0; // Track maximum horizontal displacement during touch
let maxDeltaY = 0; // Track maximum vertical displacement during touch

// Position we have to restore when the book opens (last reading position).
var initialCfi = null;

// book.locations.generate() runs in the background after the first paint,
// progress percentages are meaningless until it finishes.
var locationsReady = false;

// Location generation granularity (characters per location point)
// Smaller value = more location points = higher accuracy but slower generation
// 256 chars ≈ 160 location points for typical book ≈ ±0.6% accuracy
var LOCATION_GENERATION_GRANULARITY = 256;

// Longest we wait for fonts/images before showing the reader anyway (ms)
var CONTENT_SETTLE_TIMEOUT = 1500;

// A saved position can be at most this many pages behind the page it belongs
// to (one page in practice — the guard is only there to bound the loop).
var MAX_SNAP_STEPS = 3;

// Name of the single theme holding every reader style (line height + colors).
// epub.js only injects the *currently selected* theme, so everything has to
// live in one theme — registering several and selecting the last one silently
// drops the others.
var READER_THEME = 'reader';

// Current reader style, single source of truth for all style setters.
var readerStyle = {
  fontFamily: null,
  fontSize: null,       // in px
  lineSpacing: null,
  backgroundColor: null,
  foregroundColor: null
};




// 检测 iOS（包括 iPhone 和 iPad）
function detectIOS() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;

  // 检测 iPhone, iPad, iPod
  return /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
}

// [NEW] Fixes all wavy annotations
function fixWavyAnnotations() {
  console.log('[EPUB] Fixing wavy annotations...');
  for (var cfi in wavyAnnotations) {
    var item = wavyAnnotations[cfi];
    if (item && item.annotation && item.annotation.mark && item.annotation.mark.element) {
      applyWavyStyles(item.annotation.mark.element, item.color);
    }
  }
}
// [NEW] Applies wavy style to an element (clears rects, adds paths)
function applyWavyStyles(element, color) {
  if (!element) return;
  // 1. Hide default rects
  var rects = element.querySelectorAll('rect');
  rects.forEach(function (rect) {
    rect.setAttribute('fill', 'none');
    rect.setAttribute('fill-opacity', '0');
    rect.setAttribute('stroke', 'none');
    rect.style.setProperty('fill', 'none', 'important'); // Ensure overridden
  });

  // 2. Clear existing paths to prevent duplicates
  var oldPaths = element.querySelectorAll('path');
  oldPaths.forEach(function (p) { p.remove(); });
  // 3. Add wavy paths
  rects.forEach(function (rect) {
    var x1 = parseFloat(rect.getAttribute('x'));
    var y = parseFloat(rect.getAttribute('y')) + parseFloat(rect.getAttribute('height'));
    var width = parseFloat(rect.getAttribute('width'));
    var x2 = x1 + width;
    // Create wavy path using quadratic bezier curves
    var waveHeight = 3;
    var waveLength = 8;
    var pathData = 'M ' + x1 + ' ' + y;
    var currentX = x1;
    var isUp = true;
    while (currentX < x2) {
      var nextX = Math.min(currentX + waveLength, x2);
      var controlY = isUp ? (y - waveHeight) : (y + waveHeight);
      pathData += ' Q ' + (currentX + waveLength / 2) + ' ' + controlY + ' ' + nextX + ' ' + y;
      currentX = nextX;
      isUp = !isUp;
    }
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.style.setProperty('stroke', color, 'important');
    element.appendChild(path);
  });
}

function getCfiFromSelection(contents) {
  try {
    var selection = contents.window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    var range = selection.getRangeAt(0);
    if (!range || range.collapsed) {
      return null;
    }

    // epub.js 提供的 API：把 DOM Range 转成 CFI
    if (typeof contents.cfiFromRange === 'function') {
      return contents.cfiFromRange(range);
    }

    return null;
  } catch (e) {
    console.error('[EPUB] Error computing CFI from selection:', e);
    return null;
  }
}



/**
 * Entry point called from Flutter (see EpubViewer.loadBook on the Dart side).
 *
 * @param {Array<number>} data  raw bytes of the epub file
 * @param {Object} options      { cfi, manager, flow, spread, axis, snap,
 *                                allowScriptedContent, direction,
 *                                clearSelectionOnPageChange,
 *                                fontSize, fontFamily, lineSpacing,
 *                                backgroundColor, foregroundColor }
 */
function loadBook(data, options) {
  var opts = options || {};

  clearSelectionOnPageChange = opts.clearSelectionOnPageChange !== false;
  currentFlow = parseFlow(opts.flow);
  initialCfi = opts.cfi || null;

  readerStyle.fontFamily = opts.fontFamily || null;
  readerStyle.fontSize = opts.fontSize || null;
  readerStyle.lineSpacing = opts.lineSpacing || null;
  readerStyle.backgroundColor = opts.backgroundColor || null;
  readerStyle.foregroundColor = opts.foregroundColor || null;

  console.log('[EPUB] loadBook, 初始cfi:', initialCfi, 'flow:', currentFlow);

  // Center the viewer content (important for paginated resized view)
  var viewer = document.getElementById('viewer');
  viewer.style.display = 'flex';
  viewer.style.flexDirection = 'column';
  viewer.style.alignItems = 'center';
  viewer.style.justifyContent = 'center';

  book.open(new Uint8Array(data));
  rendition = book.renderTo("viewer", {
    manager: opts.manager || 'default',
    flow: currentFlow,
    spread: opts.spread || 'auto',
    width: "100%",
    height: "100%",
    snap: !!opts.snap,
    allowScriptedContent: !!opts.allowScriptedContent,
    defaultDirection: opts.direction || 'ltr'
  });

  guardPageTurns();
  registerBaseTheme();
  registerContentHooks();
  registerRenditionEvents();

  book.loaded.navigation.then(function (toc) {
    chapters = parseChapters(toc);
    window.flutter_inappwebview.callHandler('chapters');
  });

  // 在滚动模式下，真正滚动的是 epub.js 创建的 .epub-container 容器，
  // 而不是外层的 #viewer，因此这里显式对该容器添加监听并向 Flutter 上报。
  if (currentFlow.indexOf('scrolled') > -1) {
    attachEpubScrollListener();
  }

  startReading();
}

/**
 * Boot sequence. The order here is what keeps the reader from flashing:
 *
 *   1. wait for the book to be parsed
 *   2. preload the font and push EVERY style setting into epub.js — nothing is
 *      rendered yet, so this costs no reflow
 *   3. render the restored reading position exactly once, already laid out
 *      with its final font / size / line-height
 *   4. reveal the viewer and tell Flutter we are ready
 *   5. generate locations in the background (they are only needed for the
 *      progress percentage, and generating them takes seconds on a big book)
 *
 * The previous implementation displayed the book first, applied the styles
 * afterwards (each one re-flowing back to the start of the chapter) and only
 * then jumped to the saved position — which is what the user saw as a flash
 * of page one followed by a jump.
 */
async function startReading() {
  try {
    await book.ready;

    if (readerStyle.fontFamily) {
      try {
        await loadFontAsDataURI(readerStyle.fontFamily);
      } catch (err) {
        console.warn('[EPUB] Font preload failed, falling back to default:', err);
      }
    }

    applyReaderStyle();

    console.log('[EPUB] Displaying initial position:', initialCfi);
    var target = resolveDisplayTarget(initialCfi);
    await rendition.display(target);
    await restoreExactly(target);
  } catch (err) {
    console.error('[EPUB] Failed to open at initial position:', err);
    // Last resort: show the beginning of the book rather than a blank page.
    try {
      await rendition.display();
    } catch (err2) {
      console.error('[EPUB] Failed to display book:', err2);
    }
  }

  await nextFrame();
  setViewerVisible(true);
  window.flutter_inappwebview.callHandler('readerReady');

  book.locations.generate(LOCATION_GENERATION_GRANULARITY).then(function () {
    locationsReady = true;
    console.log('[EPUB] Book locations generated:', book.locations.length());
    window.flutter_inappwebview.callHandler('locationsLoaded');
    // Re-report the current location so the progress percentage becomes real.
    reportLocation();
  }).catch(function (err) {
    console.error('[EPUB] Failed to generate locations:', err);
  });
}

/**
 * Pin the reader to [target] once the rendered content has stopped moving.
 *
 * The first layout is measured before the injected @font-face (and any images)
 * have finished loading, so the text re-flows right afterwards. A re-flow moves
 * the page breaks, which leaves the reader one page off — the saved position
 * ends up at the bottom of the displayed page instead of at its top.
 *
 * Runs while the viewer is still hidden, so it costs nothing visually.
 */
async function restoreExactly(target) {
  await waitForContentSettled();

  // Section hrefs always land at offset 0, they cannot drift.
  if (!target || target.indexOf('epubcfi(') !== 0) return;

  var start = rendition.location && rendition.location.start;
  if (!start || start.cfi !== target) {
    console.log('[EPUB] Re-applying position after content settled:', target);
    await rendition.display(target);
  }

  await snapPastTarget(target);

  var current = rendition.location && rendition.location.start;
  console.log('[EPUB] Restored at:', current && current.cfi);
}

/**
 * Make sure [target] is at the TOP of the page, not somewhere in the middle.
 *
 * A saved position is always the start of the page the reader was on. But when
 * that page started in the middle of a text node, epub.js reports the *node's*
 * offset 0 as the page start — and that character sits on the previous page.
 * Displaying such a CFI therefore lands us one page too early, showing text the
 * user has already read (the page break splits a sentence, e.g. 「侧目而 | 视」).
 *
 * So: as long as the target is inside the current page but not at its top,
 * turn one page forward. Bounded, and it never runs past the target.
 */
async function snapPastTarget(target) {
  var cfi = new ePub.CFI();

  for (var step = 0; step < MAX_SNAP_STEPS; step++) {
    var location = rendition.location;
    if (!location || !location.start || !location.end) return;

    var pageStart = location.start.cfi;

    try {
      // 目标已经是本页开头（或更靠前），到位了
      if (cfi.compare(pageStart, target) >= 0) return;
      // 目标不在本页范围内，说明定位结果异常，不要乱翻
      if (cfi.compare(target, location.end.cfi) > 0) return;
    } catch (e) {
      console.warn('[EPUB] CFI compare failed, keeping current page:', e);
      return;
    }

    console.log('[EPUB] Target sits mid-page, turning one page forward from', pageStart);
    await rendition.next();

    var newStart = rendition.location && rendition.location.start;
    // 翻不动了（章节末尾等），就地停下，避免死循环
    if (!newStart || newStart.cfi === pageStart) return;
  }
}

/**
 * Wait until fonts and images of the rendered sections are loaded, so that the
 * layout can no longer shift under us. Capped, a slow image must not block the
 * reader from opening.
 */
function waitForContentSettled() {
  var pending = [];

  rendition.getContents().forEach(function (contents) {
    var doc = contents.document;
    if (!doc) return;

    // 自定义字体是 data URI 注入的，首帧用的是回退字体
    if (doc.fonts && doc.fonts.ready) {
      pending.push(doc.fonts.ready);
    }

    var images = doc.querySelectorAll('img');
    for (var i = 0; i < images.length; i++) {
      var image = images[i];
      if (image.complete) continue;
      pending.push(new Promise(function (resolve) {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      }));
    }
  });

  if (pending.length === 0) return nextFrame();

  var timeout = new Promise(function (resolve) {
    setTimeout(resolve, CONTENT_SETTLE_TIMEOUT);
  });

  return Promise.race([Promise.all(pending), timeout]).then(nextFrame);
}

/** Resolve after the browser has painted the next frame. */
function nextFrame() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });
}

/** The viewer starts hidden (see swipe.html) and is revealed once ready. */
function setViewerVisible(visible) {
  var viewer = document.getElementById('viewer');
  if (viewer) {
    viewer.style.opacity = visible ? '1' : '0';
  }
}

/** Wrap rendition.next/prev so we can globally block page turns when needed. */
function guardPageTurns() {
  if (!rendition) return;

  var originalNext = rendition.next.bind(rendition);
  var originalPrev = rendition.prev.bind(rendition);

  rendition.next = function () {
    if (!epubSwipeEnabled) {
      console.log('[EPUB] next blocked because swipe disabled');
      return;
    }
    return originalNext();
  };

  rendition.prev = function () {
    if (!epubSwipeEnabled) {
      console.log('[EPUB] prev blocked because swipe disabled');
      return;
    }
    return originalPrev();
  };
}

/**
 * Rules that are always injected, whatever the selected reader theme is
 * (epub.js always injects the "default" theme on top of the current one).
 */
function registerBaseTheme() {
  rendition.themes.default({
    'aside[epub\\:type="footnote"]': { 'display': 'none !important' },
    'aside[epub\\:type~="footnote"]': { 'display': 'none !important' },
    'aside[epub\\:type="endnote"]': { 'display': 'none !important' },
    'aside[epub\\:type~="endnote"]': { 'display': 'none !important' },
    'aside[role="doc-footnote"]': { 'display': 'none !important' },
    'aside[role="doc-endnote"]': { 'display': 'none !important' },
    'sup': { 'color': '#43C465 !important' },
    'a[epub\\:type="noteref"]': {
      'color': '#43C465 !important',
      'text-decoration': 'none !important'
    }
  });
}

function registerContentHooks() {

  // Handle selection clearing and changes
  rendition.hooks.content.register(function (contents) {
    // Check if there's a currently active font and inject it
    // We don't have the current font family stored globally here, 
    // but we can iterate our cache or maybe just rely on setFontFamily being called.
    // Ideally, we should inject any loaded fonts.

    var doc = contents.document;
    for (var family in fontDataCache) {
      injectFontFace(doc, family, fontDataCache[family]);
    }




    // Add click listener for <a> tags
    // Make sure to attach this listener with 'true' for the capture phase
    doc.addEventListener('click', (e) => {
      const target = e.target.closest('a');
      if (target && target.href) {
        console.log('[EPUB] click 事件触发，链接：', target.href);

        // 点击链接时，先清除选择
        if (isSelecting) {
          isSelecting = false;
          clearSelection();
        }
        // Check if it's a footnote
        if (target.href.indexOf('#') > -1 && target.href.indexOf('fn') > -1) {
          e.preventDefault();  // Stop browser navigation
          e.stopPropagation(); // Stop other scripts (like epub.js) from seeing the click

          console.log('[EPUB] Footnote clicked (通过 click 事件)');
          window.flutter_inappwebview.callHandler('footNoteTapped', target.href);
        }
      }
    }, true);

    let isIOS = detectIOS();

    console.log('[EPUB] isIOS: ', isIOS);

    if (isIOS) {

      if (currentFlow == "paginated") {

        /////////////////////////////////////////////


        contents.window.document.addEventListener('selectionchange', function () {
          const sel = contents.window.getSelection();
          const text = sel ? sel.toString() : '';
          if (text && text.length > 0) {
            isSelecting = true;
            console.log('[EPUB] 开始选择文本，禁用翻页');
            sendSelectionData(getCfiFromSelection(contents), contents, 'selectionChanging');
          } else {
            isSelecting = false;
            console.log('[EPUB] 结束选择文本，恢复翻页');
            //window.flutter_inappwebview.callHandler('selectionCleared');
          }
        });
        // touchstart: 只记录位置，不阻止
        // Use screenX/screenY for absolute screen coordinates (not affected by iframe movement)
        contents.document.addEventListener('touchstart', function (e) {
          const touch = e.touches[0];
          touchStartX = touch.screenX;
          touchStartY = touch.screenY;
          touchStartTime = Date.now();
          isDragging = false;
          maxDeltaX = 0; // Reset max displacement tracking
          maxDeltaY = 0;
          console.log('[EPUB] touchstart at screen coords', touchStartX, touchStartY);
        }, true);
        // touchmove: 检测是否拖动，只在拖动时阻止
        // Use screenX/screenY to track actual finger movement on screen
        contents.document.addEventListener('touchmove', function (e) {
          const touch = e.touches[0];
          const deltaX = Math.abs(touch.screenX - touchStartX);
          const deltaY = Math.abs(touch.screenY - touchStartY);

          // Track maximum displacement during the entire gesture
          maxDeltaX = Math.max(maxDeltaX, deltaX);
          maxDeltaY = Math.max(maxDeltaY, deltaY);

          if (isSelecting) {
            // 移动超过 10px 认为是拖动
            if (deltaX > 10 || deltaY > 10) {
              isDragging = true;
              console.log('[EPUB] 检测到拖动，阻止翻页');
              e.stopPropagation();
            }
          }
        }, true);


        contents.document.addEventListener('touchend', function (e) {
          console.log('[EPUB] touchend 被调用, isSelecting:', isSelecting, 'isDragging:', isDragging);

          const target = e.target.closest('a');
          const isLinkClick = target && target.href;

          console.log('[EPUB] isLinkClick:', isLinkClick, 'href:', target ? target.href : 'none');

          // Handle footnote link clicks
          if (isLinkClick && target.href.indexOf('#') > -1 && target.href.indexOf('fn') > -1) {
            console.log('[EPUB] 注脚链接，只触发 footNoteTapped');
            e.preventDefault();
            e.stopPropagation();

            // Only call footNoteTapped, don't clear selection
            window.flutter_inappwebview.callHandler('footNoteTapped', target.href);

            // Reset flags but don't clear selection
            isDragging = false;
            return;
          }

          // Handle other link clicks
          if (isLinkClick) {
            console.log('[EPUB] 普通链接，不清除选择');
            // Reset flags but don't clear selection
            if (isSelecting) {
              isSelecting = false;
            }
            isDragging = false;
            return;
          }

          // Handle dragging end (user was adjusting selection)
          if (isSelecting && isDragging) {
            console.log('[EPUB] 拖动结束，阻止翻页');
            e.stopPropagation();
            e.preventDefault();
            isDragging = false;
            return;
          }

          // Handle tap while selecting (clear selection)
          if (isSelecting && !isDragging) {
            console.log('[EPUB] 有选择时点击空白处，清除选择');
            isSelecting = false;
            clearSelection();
            isDragging = false;
            return;
          }

          // Calculate touch movement and duration to distinguish tap from drag/swipe
          // Use maxDeltaX/maxDeltaY tracked during touchmove instead of changedTouches
          // because changedTouches may report the position after page animation completes
          const duration = Date.now() - touchStartTime;

          // Consider it a tap only if movement is minimal and duration is short
          // This prevents triggering blankAreaTap during page-turn swipes
          const isTap = maxDeltaX < 10 && maxDeltaY < 10 && duration < 150;

          console.log('[EPUB] Touch metrics - maxDeltaX:', maxDeltaX, 'maxDeltaY:', maxDeltaY, 'duration:', duration, 'isTap:', isTap);

          // Handle blank area tap (no selection, no link, and is actually a tap)
          if (isTap) {
            console.log('[EPUB] 空白区域点击');
            window.flutter_inappwebview.callHandler('blankAreaTap');
          } else {
            console.log('[EPUB] 拖动/滑动手势，不触发空白区域点击');
          }

          isDragging = false;
        }, true);

        /////////////////////////////////


      } else {
        // iOS scrolled mode
        var scrolledSelectionClearTimer = null;
        contents.window.document.addEventListener('selectionchange', function () {
          const sel = contents.window.getSelection();
          const text = sel ? sel.toString() : '';

          if (!text) {
            // Debounce: wait 300ms before reporting selectionCleared
            // In scrolled mode, the browser may briefly clear the selection on finger-lift
            // then re-establish it. This debounce prevents spurious clear events.
            if (!scrolledSelectionClearTimer) {
              scrolledSelectionClearTimer = setTimeout(function () {
                scrolledSelectionClearTimer = null;
                // Re-check: if selection is truly gone after the delay, clear
                const recheckSel = contents.window.getSelection();
                const recheckText = recheckSel ? recheckSel.toString() : '';
                if (!recheckText) {
                  window.flutter_inappwebview.callHandler('selectionCleared');
                }
              }, 300);
            }
            return;
          }

          // Text is present — cancel any pending clear timer
          if (scrolledSelectionClearTimer) {
            clearTimeout(scrolledSelectionClearTimer);
            scrolledSelectionClearTimer = null;
          }

          const finalSel = contents.window.getSelection();
          const finalText = finalSel ? finalSel.toString() : '';
          if (!finalText) return;
          sendSelectionData(getCfiFromSelection(contents), contents, 'selectionChanging');
        });

        // blankAreaTap support for scrolled mode
        contents.document.addEventListener('touchstart', function (e) {
          const touch = e.touches[0];
          touchStartX = touch.screenX;
          touchStartY = touch.screenY;
          touchStartTime = Date.now();
          maxDeltaX = 0;
          maxDeltaY = 0;
        }, true);

        contents.document.addEventListener('touchmove', function (e) {
          const touch = e.touches[0];
          maxDeltaX = Math.max(maxDeltaX, Math.abs(touch.screenX - touchStartX));
          maxDeltaY = Math.max(maxDeltaY, Math.abs(touch.screenY - touchStartY));
        }, true);

        contents.document.addEventListener('touchend', function (e) {
          const target = e.target.closest('a');
          if (target && target.href) return;

          const duration = Date.now() - touchStartTime;
          const isTap = maxDeltaX < 10 && maxDeltaY < 10 && duration < 300;

          // Only clear selection on deliberate tap, not on finger-lift after long-press
          const sel = contents.window.getSelection();
          if (sel && sel.toString().length > 0) {
            if (isTap) {
              isSelecting = false;
              clearSelection();
            }
            return;
          }

          if (isTap) {
            console.log('[EPUB] [iOS scrolled] blank area tap');
            window.flutter_inappwebview.callHandler('blankAreaTap');
          }
        }, true);

      }


    } else {
      // Android platform
      contents.window.document.addEventListener('selectionchange', function () {
        const sel = contents.window.getSelection();
        const text = sel ? sel.toString() : '';

        if (!text) {
          window.flutter_inappwebview.callHandler('selectionCleared');
          return;
        }

        const finalSel = contents.window.getSelection();
        const finalText = finalSel ? finalSel.toString() : '';
        if (!finalText) return;
        sendSelectionData(getCfiFromSelection(contents), contents, 'selectionChanging');

      });

      // Add touch event handlers for Android to support blankAreaTap
      // Works in both paginated and scrolled modes
      contents.document.addEventListener('touchstart', function (e) {
        const touch = e.touches[0];
        touchStartX = touch.screenX;
        touchStartY = touch.screenY;
        touchStartTime = Date.now();
        isDragging = false;
        maxDeltaX = 0;
        maxDeltaY = 0;
      }, true);

      contents.document.addEventListener('touchmove', function (e) {
        const touch = e.touches[0];
        maxDeltaX = Math.max(maxDeltaX, Math.abs(touch.screenX - touchStartX));
        maxDeltaY = Math.max(maxDeltaY, Math.abs(touch.screenY - touchStartY));
      }, true);

      contents.document.addEventListener('touchend', function (e) {
        const target = e.target.closest('a');
        if (target && target.href) return;

        // If there is an active selection, handle clearing instead
        if (currentFlow !== 'paginated') {
          const sel = contents.window.getSelection();
          if (sel && sel.toString().length > 0) {
            isSelecting = false;
            clearSelection();
            return;
          }
        }

        const duration = Date.now() - touchStartTime;
        // In scrolled mode use more generous thresholds since slight scroll is common
        var maxD = currentFlow === 'paginated' ? 5 : 10;
        var maxDur = currentFlow === 'paginated' ? 100 : 300;
        const isTap = maxDeltaX < maxD && maxDeltaY < maxD && duration < maxDur;

        if (isTap) {
          console.log('[EPUB] [Android] blank area tap (flow=' + currentFlow + ')');
          window.flutter_inappwebview.callHandler('blankAreaTap');
        }
      }, true);

    }




  });






  // Function to calculate and send selection data
  // 优先使用当前浏览器的 Selection.toString()，这样可以正确覆盖跨段落的选区；
  // 若 Selection 不可用，再回退到 book.getRange(cfiRange)。
  function sendSelectionData(cfiRange, contents, handlerName) {
    handlerName = handlerName;
    console.log('[EPUB] sendSelectionData: ', contents, 'handlerName: ', handlerName);

    try {
      var selection = contents.window.getSelection();
      var selectedText = selection && selection.toString ? selection.toString() : '';
      var rect = null;

      if (selection && selection.rangeCount > 0) {
        // Get the range and its client rect (relative to iframe viewport)
        var selRange = selection.getRangeAt(0);
        var clientRect = selRange.getBoundingClientRect();

        // Get the WebView dimensions (parent window)
        var webViewWidth = window.innerWidth;
        var webViewHeight = window.innerHeight;

        // Get the iframe element in the parent document
        var iframe = contents.document.defaultView.frameElement;
        var iframeRect = iframe.getBoundingClientRect();

        // Calculate absolute position in WebView (iframe offset + selection position)
        var absoluteLeft = iframeRect.left + clientRect.left;
        var absoluteTop = iframeRect.top + clientRect.top;

        // Normalize to 0-1 range relative to WebView dimensions
        rect = {
          left: absoluteLeft / webViewWidth,
          top: absoluteTop / webViewHeight,
          width: clientRect.width / webViewWidth,
          height: clientRect.height / webViewHeight,
          contentHeight: webViewHeight
        };
      }

      if (selectedText && selectedText.length > 0) {
        var args = [cfiRange.toString(), selectedText, rect];
        window.flutter_inappwebview.callHandler(handlerName, ...args);
      } else {
        // Fallback: use book.getRange when Selection text is not available
        book.getRange(cfiRange).then(function (range) {
          var fallbackText = range.toString();
          var args = [cfiRange.toString(), fallbackText, rect];
          window.flutter_inappwebview.callHandler(handlerName, ...args);
        }).catch(function (e) {
          console.error('[EPUB] Error in fallback getRange:', e);
          var args = [cfiRange.toString(), '', rect];
          window.flutter_inappwebview.callHandler(handlerName, ...args);
        });
      }
    } catch (e) {
      console.error('[EPUB] Error in sendSelectionData:', e);
      var args = [cfiRange.toString(), '', null];
      window.flutter_inappwebview.callHandler(handlerName, ...args);
    }
  }



  // Underline annotations lose their custom style whenever epub.js re-renders
  // their marks, so re-apply it every time content is (re)loaded.
  rendition.hooks.content.register(() => {
    function fixUnderlineStyles() {
      // Skip if we're in the middle of adding an underline
      if (isAddingUnderline) {
        return;
      }

      var fixedCount = 0;
      var totalCount = 0;

      for (var cfi in underlineAnnotations) {
        totalCount++;
        var annotation = underlineAnnotations[cfi];
        var style = underlineStyles[cfi] || {};
        var color = style.color || '#ff0000';
        var isDashed = typeof style.isDashed !== 'undefined' ? style.isDashed : true;

        if (annotation && annotation.mark && annotation.mark.element) {
          applyUnderlineStyles(annotation.mark.element, color, isDashed);
          fixedCount++;
        }
      }

      if (totalCount > 0) {
        console.log('[EPUB] Fixed ' + fixedCount + '/' + totalCount + ' underline styles');
      }
    }

    // Apply styles immediately and once more after a short delay
    fixUnderlineStyles();
    setTimeout(fixUnderlineStyles, 200);
  });
}

/** Rendition level events forwarded to Flutter. */
function registerRenditionEvents() {
  rendition.on("rendered", function () {
    // Wavy highlights are drawn as raw SVG paths, they have to be re-applied
    // every time epub.js re-renders their mark elements.
    setTimeout(fixWavyAnnotations, 100);
  });

  rendition.on("relocated", function (location) {
    console.log('[EPUB] relocated: ', location.start.cfi, location.end.cfi, location.start.percentage);

    // Clear selection when navigating to a new page (if enabled)
    if (clearSelectionOnPageChange && currentFlow.indexOf('scrolled') > -1) {
      rendition.getContents().forEach(function (contents) {
        try {
          if (contents.window.getSelection) {
            contents.window.getSelection().removeAllRanges();
          }
        } catch (e) {
          // Ignore errors if iframe is not accessible
        }
      });
      window.flutter_inappwebview.callHandler('selectionCleared');
    }

    window.flutter_inappwebview.callHandler('relocated', buildLocationPayload(location));

    setTimeout(fixWavyAnnotations, 100);
  });

  rendition.on('displayError', function () {
    window.flutter_inappwebview.callHandler('displayError');
  });

  rendition.on('markClicked', function (cfiRange) {
    window.flutter_inappwebview.callHandler('markClicked', cfiRange.toString());
  });
}

/**
 * Progress is reported as -1 until book.locations has been generated,
 * so that Flutter can tell "0% of the book" from "not known yet".
 */
function buildLocationPayload(location) {
  return {
    startCfi: location.start.cfi,
    endCfi: location.end.cfi,
    progress: locationsReady ? (location.start.percentage || 0) : -1
  };
}

/** Push the current location to Flutter without waiting for a page turn. */
function reportLocation() {
  var location = rendition && rendition.location;
  if (!location || !location.start) return;
  window.flutter_inappwebview.callHandler('relocated', buildLocationPayload(location));
}

// Attach a scroll listener to the actual scrolling container (e.g., .epub-container)
function attachEpubScrollListener() {
  if (scrollListenerAttached) {
    return;
  }

  // epub.js 会在 #viewer 内部创建一个 .epub-container 作为滚动容器
  var container = document.querySelector('.epub-container');

  if (!container) {
    // 如果此时容器尚未创建，稍后重试一次
    setTimeout(attachEpubScrollListener, 100);
    return;
  }

  scrollTarget = container;
  lastScrollTop = scrollTarget.scrollTop || 0;

  scrollTarget.addEventListener(
    'scroll',
    function () {
      var scrollTop = scrollTarget.scrollTop || 0;
      var maxScrollTop =
        (scrollTarget.scrollHeight || 0) - (scrollTarget.clientHeight || 0);

      var direction =
        scrollTop > lastScrollTop
          ? 'down'
          : (scrollTop < lastScrollTop ? 'up' : 'none');

      lastScrollTop = scrollTop;

      // Condition: 
      // 1. Start of a new scroll session
      // 2. OR Direction changed (and is valid)
      if (!isScrolling || (direction !== 'none' && direction !== lastDirection)) {

        isScrolling = true;
        lastDirection = direction; // Update the last reported direction

        console.log('[EPUB] Scroll Update. Dir:', direction);

        if (
          window.flutter_inappwebview &&
          typeof window.flutter_inappwebview.callHandler === 'function'
        ) {
          window.flutter_inappwebview.callHandler('epubScroll', {
            scrollTop: scrollTop,
            maxScrollTop: maxScrollTop,
            direction: direction,
          });
        }
      }

      // Reset the scroll session if no events for 150ms
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(function () {
        isScrolling = false;
        lastDirection = 'none'; // Reset direction state
      }, 150);
    },
    { passive: true }
  );

  scrollListenerAttached = true;
  console.log('[EPUB] Scroll listener attached on .epub-container');
}

window.addEventListener("flutterInAppWebViewPlatformReady", function (event) {
  window.flutter_inappwebview.callHandler('readyToLoad');
});

//move to next page
function next() {
  rendition.next()
}

//move to previous page
function previous() {
  rendition.prev()
}

//move to given cfi location
function toCfi(cfi) {
  displayHref(cfi);
}

/**
 * Resolve a navigation target that may be either a real CFI or a spine href
 * such as "Part0002.xhtml" / "Part0002.xhtml#sigil_toc_id_1".
 *
 * TOC hrefs are often relative to another directory, so they are fuzzy matched
 * against the spine instead of being handed straight to epub.js.
 *
 * @returns {string|undefined} something epub.js can display
 */
function resolveDisplayTarget(target) {
  if (!target) return undefined;
  if (target.indexOf('epubcfi(') === 0) return target;

  var hashIndex = target.indexOf('#');
  var base = hashIndex > -1 ? target.substring(0, hashIndex) : target;
  var fragment = hashIndex > -1 ? target.substring(hashIndex + 1) : '';

  var section = book.spine.spineItems.find(function (item) {
    return item.href === base || item.href.endsWith('/' + base);
  });

  if (!section) {
    console.log('[EPUB] 未找到匹配的 spine item: ' + base + '，按原样跳转');
    return target;
  }

  var resolved = fragment ? section.href + '#' + fragment : section.href;
  console.log('[EPUB] 找到匹配的 spine item: ' + resolved);
  return resolved;
}

/** Jump to a chapter/bookmark target, see [resolveDisplayTarget]. */
function displayHref(href) {
  if (!href) return;

  var target = resolveDisplayTarget(href);
  return rendition.display(target).then(function () {
    // 书签存的同样是「那一页的开头」，需要和恢复阅读位置一样做页面对齐
    if (target && target.indexOf('epubcfi(') === 0) {
      return snapPastTarget(target);
    }
  });
}

//get all chapters
function getChapters() {
  return chapters;
}

async function getBookInfo() {
  const metadata = book.package.metadata;
  metadata['coverImage'] = book.cover;
  console.log("getBookInfo", await book.coverUrl());
  return metadata;
}


function getCurrentLocation() {
  return buildLocationPayload(rendition.location);
}

///parsing chapters and subitems recursively
var parseChapters = function (toc) {
  var chapters = []
  toc.forEach(function (chapter) {
    chapters.push({
      title: chapter.label,
      href: chapter.href,
      id: chapter.id,
      subitems: parseChapters(chapter.subitems)
    })
  })
  return chapters;
}

function searchInBook(query) {
  search(query).then(function (data) {
    var args = [data]
    window.flutter_inappwebview.callHandler('search', ...args);
  })
}


// adds highlight with given color (displayed as wavy underline)
function addHighlight(cfiRange, color, opacity) {
  console.log('[EPUB] addHighlight: ', cfiRange, color, opacity);
  try {
    rendition.annotations.remove(cfiRange, "highlight");
    delete wavyAnnotations[cfiRange]; // [NEW] Clear old
  } catch (err) {
    // ignore if highlight doesn't exist yet
  }

  // Create highlight annotation (creates SVG elements)
  var annotation = rendition.annotations.highlight(cfiRange, {}, (e) => {
    console.log("[EPUB] highlight clicked", e.target);
    window.flutter_inappwebview.callHandler('markClicked', cfiRange);
  }, "hl", { "fill": color, "fill-opacity": '0', "mix-blend-mode": "multiply" });

  wavyAnnotations[cfiRange] = { annotation: annotation, color: color };

  // [NEW] Apply styles after delay (using shared function)
  setTimeout(function () {
    if (annotation && annotation.mark && annotation.mark.element) {
      applyWavyStyles(annotation.mark.element, color);
    }
  }, 50);

}

// Function to apply underline styles to an element
function applyUnderlineStyles(element, color, isDashed) {
  if (!element) return;

  // Make rect elements transparent but keep them for click area
  var rects = element.querySelectorAll('rect');
  rects.forEach(function (rect) {
    rect.setAttribute('stroke', 'none');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('opacity', '0');
    rect.style.setProperty('stroke', 'none', 'important');
    rect.style.setProperty('fill', 'none', 'important');
    rect.style.setProperty('opacity', '0', 'important');
  });

  // Customize the line elements with !important styles
  var lines = element.querySelectorAll('line');
  lines.forEach(function (line) {
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-opacity', '1');
    line.setAttribute('opacity', '1');
    line.style.setProperty('stroke', color, 'important');
    line.style.setProperty('stroke-opacity', '1', 'important');
    line.style.setProperty('opacity', '1', 'important');
    if (isDashed) {
      line.setAttribute('stroke-dasharray', '2,2');
      line.style.setProperty('stroke-dasharray', '2,2', 'important');
    }
  });
}

// Fix a single underline element - always apply red dashed style for notes
function fixUnderlineElement(element) {
  if (!element) return;

  // Always apply red dashed underline style
  // This ensures consistency even when underlineStyles might be empty
  applyUnderlineStyles(element, '#ff0000', true);
}

// adds underline with optional color and style (solid/dashed)
function addUnderLine(cfiString, color, isDashed) {
  var underlineColor = color || "black";

  // Store the style for re-rendering
  underlineStyles[cfiString] = {
    color: underlineColor,
    isDashed: isDashed || false
  };

  // Check if underline already exists
  if (underlineAnnotations[cfiString]) {
    var existingAnnotation = underlineAnnotations[cfiString];
    if (existingAnnotation && existingAnnotation.mark && existingAnnotation.mark.element) {
      applyUnderlineStyles(existingAnnotation.mark.element, underlineColor, isDashed);
    }
    return existingAnnotation;
  }

  // Set flag to prevent re-rendering during underline creation
  isAddingUnderline = true;
  console.log('[EPUB] Adding underline, blocking re-renders');

  // Create the underline annotation with click handler
  var annotation = rendition.annotations.underline(cfiString, {}, (e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    window.flutter_inappwebview.callHandler('markClicked', cfiString);
  }, "ul");

  // Store the annotation object
  underlineAnnotations[cfiString] = annotation;

  // Apply custom styles after element is created, then unblock re-renders
  setTimeout(function () {
    if (annotation && annotation.mark && annotation.mark.element) {
      applyUnderlineStyles(annotation.mark.element, underlineColor, isDashed);
    }

    // Unblock re-renders after a delay to ensure the underline is fully rendered
    setTimeout(function () {
      isAddingUnderline = false;
      console.log('[EPUB] Underline added, re-renders unblocked');
    }, 100);
  }, 50);

  return annotation;
}

function addMark(cfiString) {
  rendition.annotations.mark(cfiString)
}

function removeHighlight(cfiString) {
  rendition.annotations.remove(cfiString, "highlight");
}

function removeUnderLine(cfiString) {
  rendition.annotations.remove(cfiString, "underline");
  // Remove from stored styles and annotations
  delete underlineStyles[cfiString];
  delete underlineAnnotations[cfiString];
}

function removeMark(cfiString) {
  rendition.annotations.remove(cfiString, "mark");
}

function toProgress(progress) {
  var cfi = book.locations.cfiFromPercentage(progress);
  rendition.display(cfi);
}
// Find the best matching audio entry for selected text.
// Resolves selectedCfi against the VIEWER's DOM (where it was generated),
// and entry CFIs against the ORIGINAL EPUB XHTML (where they were generated).
// The original XHTML is fetched directly from the EPUB archive and its DOM
// is expanded (br-split) to match the external tool's CFI generation.
// Both DOMs share the same body.textContent, so global char offsets are comparable.
function findMatchingAudioEntry(selectedCfi, entryCfis, selectedText) {
  return _findMatchingAudioEntryAsync(selectedCfi, entryCfis, selectedText);
}

async function _findMatchingAudioEntryAsync(selectedCfi, entryCfis, selectedText) {
  try {
    // --- 1. Resolve selectedCfi in VIEWER's DOM ---
    var contents = rendition.getContents();
    if (!contents || contents.length === 0) return -1;
    var viewerDoc = contents[0].document || contents[0].content;
    var viewerBody = viewerDoc.body || viewerDoc.querySelector('body');
    if (!viewerBody) return -1;

    function buildOffsetMap(bodyEl) {
      var map = new Map();
      var d = bodyEl.ownerDocument || document;
      var w = d.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null, false);
      var cum = 0, n;
      while (n = w.nextNode()) { map.set(n, cum); cum += n.textContent.length; }
      return map;
    }
    function charOffset(map, range) {
      var b = map.get(range.startContainer);
      return b !== undefined ? b + range.startOffset : -1;
    }

    var viewerMap = buildOffsetMap(viewerBody);
    var selectedOffset = -1;

    // Try resolving selectedCfi in viewer DOM (3 normalizations)
    function tryGetRange(cfi) {
      try { var r = rendition.getRange(cfi); if (r) return r; } catch (e) { }
      return null;
    }
    var selRange = tryGetRange(selectedCfi)
      || tryGetRange(selectedCfi.replace(/!\/2\//g, '!/'))
      || tryGetRange(selectedCfi.replace(/!\//, '!/2/'));
    if (selRange) {
      selectedOffset = charOffset(viewerMap, selRange);
    }
    // Fallback: find selectedText in body text
    if (selectedOffset < 0 && selectedText && selectedText.length > 0) {
      selectedOffset = (viewerBody.textContent || '').indexOf(selectedText);
      console.log('[EPUB] selectedCfi fallback via text, offset=' + selectedOffset);
    }
    console.log('[EPUB] selectedOffset=' + selectedOffset);
    if (selectedOffset < 0) return -1;

    // --- 2. Fetch and parse the ORIGINAL XHTML from EPUB archive ---
    var location = rendition.currentLocation();
    if (!location || !location.start) return -1;
    var section = book.spine.get(location.start.href);
    if (!section) {
      console.error('[EPUB] Cannot get current spine section');
      return -1;
    }

    // Fetch raw XHTML from EPUB archive and parse with browser's DOMParser.
    // We must NOT use section.load() because epub.js modifies the DOM (injects
    // <base>, <meta>, etc.) and uses an xmldom polyfill that may differ from
    // the browser's native parser. The external tool generated CFIs against
    // the original unmodified XHTML, so we must parse the same source.
    var href = section.canonical || section.href;
    var xmlText;
    if (book.archive && book.archive.getText) {
      xmlText = await book.archive.getText(href);
    } else if (book.archive && book.archive.request) {
      xmlText = await book.archive.request(href, 'text');
    } else {
      var resolved = book.resolve ? book.resolve(href) : href;
      var resp = await fetch(resolved);
      xmlText = await resp.text();
    }
    var parser = new DOMParser();
    var origDoc = parser.parseFromString(xmlText, 'application/xhtml+xml');
    var origBody = origDoc.body || origDoc.querySelector('body');
    if (!origBody) {
      console.error('[EPUB] Original doc has no body');
      return -1;
    }

    // --- 3. Expand <br/>-containing elements to match external tool's DOM ---
    // External TTS tools split elements at <br/> into separate elements,
    // e.g. <div>A<br/>B<br/>C</div> becomes <p>A</p><p>B</p><p>C</p>
    // This changes element indices in CFI paths, so we replicate the transform.
    function expandBrElements(body) {
      var ownerDoc = body.ownerDocument || document;
      // Collect elements to expand (snapshot to avoid live-collection issues)
      var toExpand = [];
      for (var i = 0; i < body.children.length; i++) {
        var el = body.children[i];
        if (el.querySelectorAll && el.querySelectorAll('br').length > 0) {
          toExpand.push(el);
        }
      }
      var expandedCount = 0;
      for (var e = 0; e < toExpand.length; e++) {
        var el = toExpand[e];
        var parent = el.parentNode;
        // Split childNodes at each <br/> into segments
        var segments = [[]];
        for (var j = 0; j < el.childNodes.length; j++) {
          var child = el.childNodes[j];
          if (child.nodeType === 1 && child.nodeName.toLowerCase() === 'br') {
            segments.push([]);
          } else {
            segments[segments.length - 1].push(child);
          }
        }
        // Replace original element with one <p> per segment
        for (var s = 0; s < segments.length; s++) {
          var p = ownerDoc.createElement('p');
          for (var n = 0; n < segments[s].length; n++) {
            p.appendChild(segments[s][n].cloneNode(true));
          }
          // Trim leading/trailing whitespace in text-only segments
          if (p.childNodes.length === 1 && p.childNodes[0].nodeType === 3) {
            p.childNodes[0].textContent = p.childNodes[0].textContent.replace(/^[\r\n]+|[\r\n]+$/g, '');
          }
          parent.insertBefore(p, el);
        }
        parent.removeChild(el);
        expandedCount += segments.length - 1; // net new elements added
      }
      if (expandedCount > 0) {
        console.log('[EPUB] expandBrElements: expanded ' + toExpand.length +
          ' element(s), added ' + expandedCount + ' new elements, body now has ' +
          body.childElementCount + ' element children');
      }
    }

    expandBrElements(origBody);

    // Rebuild offset map after expansion
    var origMap = buildOffsetMap(origBody);
    console.log('[EPUB] origDoc body childElementCount:', origBody.childElementCount,
      'textContent length:', origBody.textContent ? origBody.textContent.length : 0);

    // --- 4. Resolve each entry CFI in the expanded document ---
    // EPUB CFI child index rules:
    // Even index (2,4,6...) = element child; /4 means 2nd element child
    // Odd index (1,3,5...) = text node between elements
    function nthCfiChild(parent, n) {
      if (!parent || !parent.childNodes) return null;
      var kids = parent.childNodes;
      if (n % 2 === 0) {
        var target = n / 2, count = 0;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].nodeType === 1) {
            count++;
            if (count === target) return kids[i];
          }
        }
      } else {
        var target = (n + 1) / 2;
        var count = 0;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].nodeType === 1) {
            count++;
            if (count === target) {
              for (var j = i - 1; j >= 0; j--) {
                if (kids[j].nodeType === 3) return kids[j];
              }
              return null;
            }
          }
        }
        for (var i = kids.length - 1; i >= 0; i--) {
          if (kids[i].nodeType === 3) return kids[i];
        }
      }
      return null;
    }

    function resolveCfiInDoc(cfi, doc) {
      var m = cfi.match(/epubcfi\(([^)]+)\)/);
      if (!m) return null;
      var inner = m[1];

      var bangIdx = inner.indexOf('!');
      if (bangIdx < 0) return null;
      var contentPart = inner.substring(bangIdx + 1);

      var commaIdx = contentPart.indexOf(',');
      var elemPath, rangePart;
      if (commaIdx >= 0) {
        elemPath = contentPart.substring(0, commaIdx);
        rangePart = contentPart.substring(commaIdx + 1).split(',')[0];
      } else {
        elemPath = contentPart;
        rangePart = '';
      }

      var steps = elemPath.split('/').filter(function (s) { return s.length > 0; });
      // doc is always a proper Document (nodeType 9) from DOMParser
      var node = doc.documentElement || doc.firstElementChild;
      if (!node) return null;

      for (var i = 0; i < steps.length; i++) {
        var idx = parseInt(steps[i]);
        if (isNaN(idx)) return null;
        // First step: /2 means <html> root, skip since we start there
        if (i === 0 && idx === 2) continue;
        var child = nthCfiChild(node, idx);
        if (!child) return null;
        node = child;
      }

      var charOff = 0;
      if (rangePart) {
        var rm = rangePart.match(/\/(\d+):(\d+)/);
        if (rm) {
          var textIdx = parseInt(rm[1]);
          charOff = parseInt(rm[2]);
          var textChild = nthCfiChild(node, textIdx);
          if (textChild) node = textChild;
        }
      }

      try {
        var range = doc.createRange();
        var maxOff = (node.nodeType === 3) ? node.textContent.length : 0;
        range.setStart(node, Math.min(charOff, maxOff));
        return range;
      } catch (e) { return null; }
    }

    var bestIdx = -1, bestOffset = -1, resolvedCount = 0;
    for (var i = 0; i < entryCfis.length; i++) {
      var range = resolveCfiInDoc(entryCfis[i], origDoc);
      if (!range) {
        console.warn('[EPUB] entry[' + i + '] FAILED to resolve: ' + entryCfis[i]);
        continue;
      }
      resolvedCount++;
      var offset = charOffset(origMap, range);
      if (offset >= 0 && offset <= selectedOffset && offset > bestOffset) {
        bestIdx = i;
        bestOffset = offset;
      }
    }

    console.log('[EPUB] findMatchingAudioEntry: resolved=' + resolvedCount + '/' + entryCfis.length + ', bestIdx=' + bestIdx + ', bestOffset=' + bestOffset + ', selectedOffset=' + selectedOffset);
    return bestIdx;
  } catch (e) {
    console.error('[EPUB] findMatchingAudioEntry error:', e);
    return -1;
  }
}


function search(q) {
  return Promise.all(
    book.spine.spineItems.map(item => item.load(book.load.bind(book)).then(item.find.bind(item, q)).finally(item.unload.bind(item)))
  ).then(results => Promise.resolve([].concat.apply([], results)));
};



function setSpread(spread) {
  rendition.spread(spread);
}

function setFlow(flow) {
  currentFlow = parseFlow(flow);
  rendition.flow(currentFlow);
}

function setManager(manager) {
  rendition.manager(manager);
}



function setFontSize(fontSize) {
  readerStyle.fontSize = parseFloat(fontSize) || readerStyle.fontSize;
  console.log('[EPUB] setFontSize:', readerStyle.fontSize);
  rendition.themes.fontSize(readerStyle.fontSize + 'px');
  restorePositionAfterReflow();
}

function setFontFamily(fontFamily) {
  console.log('[EPUB] setFontFamily:', fontFamily);
  readerStyle.fontFamily = fontFamily;

  return loadFontAsDataURI(fontFamily).then(function (dataURI) {
    injectFontIntoViews(fontFamily, dataURI);
    rendition.themes.font(fontFamily);
    restorePositionAfterReflow();
  }).catch(function (err) {
    console.error('[EPUB] Font load failed, applying anyway', err);
    rendition.themes.font(fontFamily);
    restorePositionAfterReflow();
  });
}

///update theme colors, keeping the rest of the reader style intact
function updateTheme(backgroundColor, foregroundColor) {
  if (backgroundColor) readerStyle.backgroundColor = backgroundColor;
  if (foregroundColor) readerStyle.foregroundColor = foregroundColor;
  applyReaderStyle();
}


//get current page text
function getCurrentPageText() {
  var startCfi = rendition.location.start.cfi
  var endCfi = rendition.location.end.cfi
  var cfiRange = makeRangeCfi(startCfi, endCfi)
  book.getRange(cfiRange).then(function (range) {
    var text = range.toString();
    var args = [text, cfiRange]
    window.flutter_inappwebview.callHandler('epubText', ...args);
  })
}

//get text from a range
function getTextFromCfi(startCfi, endCfi) {
  var cfiRange = makeRangeCfi(startCfi, endCfi)
  book.getRange(cfiRange).then(function (range) {
    var text = range.toString();
    var args = [text, cfiRange]
    window.flutter_inappwebview.callHandler('epubText', ...args);
  })
}

const makeRangeCfi = (a, b) => {
  const CFI = new ePub.CFI()
  const start = CFI.parse(a), end = CFI.parse(b)
  const cfi = {
    range: true,
    base: start.base,
    path: {
      steps: [],
      terminal: null
    },
    start: start.path,
    end: end.path
  }
  const len = cfi.start.steps.length
  for (let i = 0; i < len; i++) {
    if (CFI.equalStep(cfi.start.steps[i], cfi.end.steps[i])) {
      if (i == len - 1) {
        // Last step is equal, check terminals
        if (cfi.start.terminal === cfi.end.terminal) {
          // CFI's are equal
          cfi.path.steps.push(cfi.start.steps[i])
          // Not a range
          cfi.range = false
        }
      } else cfi.path.steps.push(cfi.start.steps[i])
    } else break
  }
  cfi.start.steps = cfi.start.steps.slice(cfi.path.steps.length)
  cfi.end.steps = cfi.end.steps.slice(cfi.path.steps.length)

  return 'epubcfi(' + CFI.segmentString(cfi.base)
    + '!' + CFI.segmentString(cfi.path)
    + ',' + CFI.segmentString(cfi.start)
    + ',' + CFI.segmentString(cfi.end)
    + ')'
}

// Clear current text selection inside all rendition contents and notify Flutter.
function clearSelection() {

  console.log('[EPUB] JS清空选择');

  try {
    if (!rendition) return;

    rendition.getContents().forEach(function (contents) {
      try {
        var win = contents.window;
        if (win && win.getSelection) {
          var sel = win.getSelection();
          if (sel && sel.removeAllRanges) {
            sel.removeAllRanges();
          }
        }
      } catch (e) {
        console.error('[EPUB] Error clearing selection in contents:', e);
      }
    });

    window.flutter_inappwebview.callHandler('selectionCleared');
  } catch (e) {
    console.error('[EPUB] Error in clearSelection:', e);
  }
}

// Exposed function for Flutter to enable/disable swipe & page turn globally
function setSwipeEnabled(enabled) {
  epubSwipeEnabled = !!enabled;

  try {
    // Disable pointer events on the main viewer container so that
    // all pan/drag/tap interactions are ignored while overlays
    // (like Flutter bottom sheets) are visible.
    var viewer = document.getElementById('viewer');
    if (viewer) {
      viewer.style.pointerEvents = epubSwipeEnabled ? 'auto' : 'none';
    }
  } catch (e) {
    console.error('[EPUB] Error in setSwipeEnabled:', e);
  }

  console.log('[EPUB] setSwipeEnabled:', epubSwipeEnabled);
}


// [NEW] Helper to parse flow string (handles "EpubFlow.paginated" etc)
function parseFlow(val) {
  if (!val) return 'paginated';
  var s = val.toString();
  if (s.indexOf('.') !== -1) {
    // e.g. "EpubFlow.paginated" -> "paginated"
    return s.split('.')[1];
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader style (font / size / line height / colors)
//
// Everything goes through `readerStyle` + `applyReaderStyle()` so a single
// registered theme always carries the full style. Changing one setting can
// never drop another one, and the initial style can be applied before the
// first render (no reflow, no flash).
// ─────────────────────────────────────────────────────────────────────────────

/** Push the whole reader style into epub.js. */
function applyReaderStyle() {
  if (!rendition || !rendition.themes) return;

  var lineHeight = readerStyle.lineSpacing ? readerStyle.lineSpacing + ' !important' : null;

  var bodyRules = {};
  if (lineHeight) bodyRules['line-height'] = lineHeight;
  if (readerStyle.backgroundColor) bodyRules['background'] = readerStyle.backgroundColor;
  if (readerStyle.foregroundColor) bodyRules['color'] = readerStyle.foregroundColor;

  var blockRules = lineHeight ? { 'line-height': lineHeight } : {};

  rendition.themes.register(READER_THEME, {
    'body': bodyRules,
    'p': blockRules,
    'div': blockRules,
    'li': blockRules
  });
  rendition.themes.select(READER_THEME);

  // font-family / font-size are epub.js "overrides": they are applied on top
  // of the selected theme, so they survive theme switches.
  if (readerStyle.fontFamily) rendition.themes.font(readerStyle.fontFamily);
  if (readerStyle.fontSize) rendition.themes.fontSize(readerStyle.fontSize + 'px');
}

/**
 * Re-display the current page after a style change that re-flows the text,
 * otherwise epub.js leaves the reader at the start of the chapter.
 */
function restorePositionAfterReflow() {
  var cfi = (rendition && rendition.location && rendition.location.start)
    ? rendition.location.start.cfi
    : initialCfi;
  if (!cfi) return;

  // 100ms 让 epub.js 先跑完重排，再等字体/图片稳定，最后才回到原位置，
  // 否则会像首次打开那样被随后的回流带偏一页。
  setTimeout(function () {
    waitForContentSettled().then(function () {
      return rendition.display(cfi);
    }).then(function () {
      console.log('[EPUB] Position restored after style change:', cfi);
    });
  }, 100);
}

function setLineSpacing(spacing) {
  readerStyle.lineSpacing = parseFloat(spacing) || readerStyle.lineSpacing;
  console.log('[EPUB] setLineSpacing:', readerStyle.lineSpacing);
  applyReaderStyle();
  restorePositionAfterReflow();
}

var fontDataCache = {};
var fontFileMap = {
  // CSS values (正确的名称)
  'FZKTJW': 'FZKTJW.TTF',
  'FZLanTYJW_Zhun': 'FZLanTYJW_Zhun.TTF',
  'FZZHUNYSJW': 'FZZHUNYSJW.TTF',
  'PingFangSC-Regular': 'PingFangSC-Regular.ttf',
  // Enum names (别名，为了兼容性)
  'fangzhengkaite': 'FZKTJW.TTF',
  'fangzhenglanting': 'FZLanTYJW_Zhun.TTF',
  'fangzhengyasong': 'FZZHUNYSJW.TTF',
  'systemDefault': 'PingFangSC-Regular.ttf'
};

async function loadFontAsDataURI(fontFamily) {
  if (fontDataCache[fontFamily]) return fontDataCache[fontFamily];

  var fileName = fontFileMap[fontFamily];
  if (!fileName) return null;

  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', fileName, true);
    xhr.responseType = 'blob';

    xhr.onload = function () {
      if (this.status === 0 || this.status === 200) {
        var reader = new FileReader();
        reader.onloadend = function () {
          fontDataCache[fontFamily] = reader.result;
          resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(this.response);
      } else {
        console.error('[EPUB] Failed to load font ' + fileName + ' status: ' + this.status);
        reject(new Error('Failed to load font: ' + this.status));
      }
    };

    xhr.onerror = function (e) {
      console.error('[EPUB] Network error loading font ' + fileName, e);
      reject(new Error('Network error loading font'));
    };

    xhr.send();
  });
}

function injectFontFace(doc, fontFamily, dataURI) {
  if (!dataURI) return;

  // Check if rule already exists
  var id = 'font-face-' + fontFamily;
  if (doc.getElementById(id)) return;

  var style = doc.createElement('style');
  style.id = id;
  style.textContent = `
        @font-face {
            font-family: "${fontFamily}";
            src: url("${dataURI}");
            font-weight: normal;
            font-style: normal;
        }
    `;
  doc.head.appendChild(style);
  // console.log('[EPUB] Injected @font-face for', fontFamily);
}

/** Inject an already loaded @font-face into every rendered view. */
function injectFontIntoViews(fontFamily, dataURI) {
  if (!dataURI || !rendition || !rendition.views()) return;
  rendition.views().forEach(function (view) {
    if (view.document) {
      injectFontFace(view.document, fontFamily, dataURI);
    }
  });
}

function getContentFromUrl(url) {
  console.log('[EPUB] getContentFromUrl:', url);
  try {
    // Extract hash from URL (e.g., "file.xhtml#id")
    var hash = url.split('#')[1];
    if (!hash) {
      console.log('[EPUB] No hash found in URL');
      return null;
    }

    var content = null;
    // Search in all rendered contents
    if (rendition) {
      rendition.getContents().forEach(function (c) {
        var doc = c.document;
        var el = doc.getElementById(hash);
        if (el) {
          content = el.innerHTML;
        }
      });
    }

    return content;
  } catch (e) {
    console.error('[EPUB] Error in getContentFromUrl:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Previous / next article buttons
//
// Appended at the very end of the book content (last rendered section), used by
// the app when an epub article has siblings inside a collection.
// ─────────────────────────────────────────────────────────────────────────────

function navButtonCss(enabled) {
  return 'flex:1;' +
    'height:52px;' +
    'border:none;' +
    'border-radius:12px;' +
    'font-size:17px;' +
    'font-weight:500;' +
    'letter-spacing:0.5px;' +
    '-webkit-tap-highlight-color:transparent;' +
    'transition:all 0.3s ease;' +
    'background:' + (enabled ? '#009F4D' : '#F5F5F5') + ';' +
    'color:' + (enabled ? '#FFFFFF' : '#CCCCCC') + ';' +
    'cursor:' + (enabled ? 'pointer' : 'not-allowed') + ';' +
    'box-shadow:' + (enabled ? '0 2px 8px rgba(0, 159, 77, 0.15)' : 'none') + ';';
}

function buildNavButton(doc, label, enabled, handlerName) {
  var button = doc.createElement('button');
  button.textContent = label;
  button.style.cssText = navButtonCss(enabled);
  button.disabled = !enabled;

  if (enabled) {
    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.flutter_inappwebview.callHandler(handlerName);
    });
  }

  return button;
}

/**
 * Add navigation buttons (Previous/Next) to the end of the epub content.
 * @param {boolean} hasPrevious - Whether a previous article is available
 * @param {boolean} hasNext - Whether a next article is available
 */
function addNavigationButtons(hasPrevious, hasNext) {
  console.log('[EPUB] addNavigationButtons:', hasPrevious, hasNext);

  if (!rendition) {
    console.warn('[EPUB] Rendition not available');
    return;
  }

  var views = rendition.views();
  var view = views && views.last();
  var doc = view && view.document;
  if (!doc || !doc.body) {
    console.warn('[EPUB] No rendered content to append navigation buttons to');
    return;
  }

  removeNavigationButtons();

  var container = doc.createElement('div');
  container.id = 'epub-nav-buttons';
  container.style.cssText = 'display:flex;gap:16px;width:100%;padding:40px 20px;box-sizing:border-box;';
  container.appendChild(buildNavButton(doc, '上一篇', hasPrevious, 'onPreviousArticle'));
  container.appendChild(buildNavButton(doc, '下一篇', hasNext, 'onNextArticle'));

  doc.body.appendChild(container);
}

/** Remove navigation buttons from the epub content. */
function removeNavigationButtons() {
  if (!rendition) return;

  rendition.getContents().forEach(function (contents) {
    var existing = contents.document.getElementById('epub-nav-buttons');
    if (existing) existing.remove();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter title lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the TOC label of the chapter containing [cfi].
 *
 * A single xhtml file can hold several TOC entries, so when the spine item
 * matches more than one entry we compare the CFI of each anchor with the
 * current position to pick the one we are actually past.
 *
 * @returns {string} chapter label, '' when it cannot be resolved
 */
function getChapterTitleForCfi(cfi) {
  try {
    var currentCfi = cfi;
    var spineItem = book.spine.get(currentCfi);

    if (!spineItem) {
      // Fallback: use whatever epub.js thinks the current location is
      var loc = rendition.location;
      if (!loc || !loc.start) return '';
      spineItem = book.spine.get(loc.start.href);
      currentCfi = loc.start.cfi;
    }
    if (!spineItem) return '';

    var spineIndex = spineItem.index;

    // Flatten the TOC tree, preserving document order
    var flat = [];
    (function flatten(items) {
      for (var i = 0; i < items.length; i++) {
        flat.push(items[i]);
        if (items[i].subitems && items[i].subitems.length > 0) {
          flatten(items[i].subitems);
        }
      }
    })(book.navigation.toc);

    // Resolve every TOC entry to a spine index (+ anchor fragment)
    var spineItems = book.spine.spineItems;
    var resolved = [];
    for (var i = 0; i < flat.length; i++) {
      var entry = flat[i];
      var base = entry.href.split('#')[0];
      var frag = entry.href.indexOf('#') > -1 ? entry.href.split('#')[1] : null;

      var section = book.spine.get(base);
      if (!section) {
        // TOC hrefs can be relative to another directory — match on file name
        var baseName = base.split('/').pop();
        for (var s = 0; s < spineItems.length; s++) {
          if (spineItems[s].href.split('/').pop() === baseName) {
            section = spineItems[s];
            break;
          }
        }
      }

      if (section) {
        resolved.push({ entry: entry, spineIdx: section.index, frag: frag });
      }
    }

    if (resolved.length === 0) return '';

    var sameSection = resolved.filter(function (r) { return r.spineIdx === spineIndex; });

    if (sameSection.length === 1) {
      return (sameSection[0].entry.label || '').trim();
    }

    if (sameSection.length > 1) {
      var contents = rendition.getContents();
      if (contents && contents.length > 0) {
        var doc = contents[0].document;
        var cfiBase = contents[0].cfiBase;
        if (doc && cfiBase) {
          var best = sameSection[0];
          for (var j = 0; j < sameSection.length; j++) {
            var candidate = sameSection[j];
            if (!candidate.frag) {
              best = candidate;
              continue;
            }
            var el = doc.getElementById(candidate.frag);
            if (!el) continue;
            try {
              var elCfi = new ePub.CFI(el, cfiBase).toString();
              if (elCfi && new ePub.CFI().compare(elCfi, currentCfi) <= 0) {
                best = candidate;
              }
            } catch (e) {
              console.log('[EPUB] CFI compare failed for #' + candidate.frag + ': ' + e);
            }
          }
          return (best.entry.label || '').trim();
        }
      }
      // Fallback: TOC order ≈ document order
      return (sameSection[sameSection.length - 1].entry.label || '').trim();
    }

    // No TOC entry for this spine item — use the last one before it
    var previous = null;
    for (var k = 0; k < resolved.length; k++) {
      if (resolved[k].spineIdx <= spineIndex) previous = resolved[k];
    }
    return previous ? (previous.entry.label || '').trim() : '';
  } catch (e) {
    console.error('[EPUB] getChapterTitleForCfi error:', e);
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paginated boundary patches
//
// epub.js' continuous manager mis-handles chapter boundaries on iOS:
//  * a scroll triggered check() prepends a section before the current view,
//    and iOS fails to compensate the scroll offset → multi page jumps
//  * the snapper does not hand over to prev()/next() at the edges
// Both are patched at runtime because the epub.js bundle is vendored.
// ─────────────────────────────────────────────────────────────────────────────

var paginatedPatchesApplied = false;

function applyPaginatedBoundaryPatches() {
  if (paginatedPatchesApplied) return;
  if (!rendition || !rendition.manager) {
    console.log('[EPUB-PATCH] Rendition not ready, skipping.');
    return;
  }

  try {
    var mgr = rendition.manager;

    // ── FIX 1: only allow prepend() during an explicit rendition.prev() ──
    var origPrepend = mgr.prepend.bind(mgr);
    var prependAllowed = false;
    mgr.prepend = function (section) {
      if (!prependAllowed) {
        console.log('[EPUB-PATCH] Blocked auto-prepend for section:', section && section.index);
        return null;
      }
      return origPrepend(section);
    };

    // check() has to cope with prepend() returning null → append-only variant
    var origCheck = mgr.check.bind(mgr);
    mgr.check = function (_offsetLeft, _offsetTop) {
      if (prependAllowed) {
        return origCheck(_offsetLeft, _offsetTop);
      }

      var horizontal = mgr.settings.axis === "horizontal";
      var delta = mgr.settings.offset || 0;
      if (_offsetLeft && horizontal) delta = _offsetLeft;
      if (_offsetTop && !horizontal) delta = _offsetTop;

      var offset = horizontal ? mgr.scrollLeft : mgr.scrollTop;
      var visibleLength = horizontal ? Math.floor(mgr._bounds.width) : mgr._bounds.height;
      var contentLength = horizontal ? mgr.container.scrollWidth : mgr.container.scrollHeight;

      var newViews = [];
      if (offset + visibleLength + delta >= contentLength) {
        var last = mgr.views.last();
        var next = last && last.section.next();
        if (next) newViews.push(mgr.append(next));
      }

      if (!newViews.length) {
        mgr.q.enqueue(function () { mgr.update(); });
        return Promise.resolve(false);
      }

      return Promise.all(newViews.map(function (view) {
        return view.display(mgr.request);
      })).then(function () {
        return mgr.check();
      }).then(function () {
        return mgr.update(delta);
      });
    };

    // ── FIX 2: hand over to prev()/next() when snapping past an edge ──
    if (mgr.snapper) {
      var snapper = mgr.snapper;
      var oldTouchEnd = snapper._onTouchEnd;

      var resetSnapperTouch = function () {
        if (snapper.fullsize) snapper.disableScroll();
        snapper.touchCanceler = false;
        snapper.startTouchX = undefined;
        snapper.startTouchY = undefined;
        snapper.endTouchX = undefined;
        snapper.endTouchY = undefined;
        snapper.startTime = undefined;
        snapper.endTime = undefined;
      };

      var patchedTouchEnd = function (e) {
        var container = mgr.container;
        var scrollLeft = container.scrollLeft;
        var maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        var swipeDir = snapper.wasSwiped();

        // At chapter start, swiping backward
        if (swipeDir === -1 && scrollLeft <= 5) {
          console.log('[EPUB-PATCH] Boundary: prev chapter. scrollLeft=' + scrollLeft);
          resetSnapperTouch();
          prependAllowed = true;
          rendition.prev();
          setTimeout(function () { prependAllowed = false; }, 3000);
          return;
        }

        // At chapter end, swiping forward
        if (swipeDir === 1 && scrollLeft >= maxScrollLeft - 5) {
          console.log('[EPUB-PATCH] Boundary: next chapter. scrollLeft=' + scrollLeft);
          resetSnapperTouch();
          rendition.next();
          return;
        }

        snapper.onTouchEnd.call(snapper, e);
      };

      // Snap binds its own listener at init, so swap both the DOM listener and
      // the events forwarded from the content iframes.
      snapper.scroller.removeEventListener('touchend', oldTouchEnd);
      snapper.scroller.addEventListener('touchend', patchedTouchEnd, { passive: true });
      snapper.off('touchend', oldTouchEnd);
      snapper.on('touchend', patchedTouchEnd);
      // Keep the ref in sync so removeListeners() still works
      snapper._onTouchEnd = patchedTouchEnd;
    }

    paginatedPatchesApplied = true;
    console.log('[EPUB-PATCH] Paginated boundary patches applied.');
  } catch (e) {
    console.error('[EPUB-PATCH] Error:', e);
  }
}

