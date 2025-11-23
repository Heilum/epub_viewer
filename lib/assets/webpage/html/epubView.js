var book = ePub();
var rendition;
var displayed;
var chapters = []
var epubSwipeEnabled = true; // Global flag to enable/disable swipe/page-turn
var clearSelectionOnPageChange = true; // Global flag for selection clearing behavior
var underlineStyles = {}; // Store underline styles by CFI for re-rendering
var underlineAnnotations = {}; // Store annotation objects by CFI for direct access
var isAddingUnderline = false; // Flag to prevent re-rendering during underline addition
var scrollListenerAttached = false; // Ensure scroll listener is only attached once
var scrollTarget = null; // Actual scrolling container (e.g., .epub-container)
var lastScrollTop = 0; // Last scrollTop for direction detection



var pointerStartX = 0;


// 检测 iOS（包括 iPhone 和 iPad）
function detectIOS() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;

  // 检测 iPhone, iPad, iPod
  return /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
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



function loadBook(data, cfi, manager, flow, spread, snap, allowScriptedContent, direction, useCustomSwipe, backgroundColor, foregroundColor, fontSize, clearSelectionOnNav, axis, fontFamily, margin) {
  // Store the clearSelectionOnPageChange setting
  clearSelectionOnPageChange = clearSelectionOnNav !== undefined ? clearSelectionOnNav : true;
  var viewportHeight = window.innerHeight;
  document.getElementById('viewer').style.height = viewportHeight;
  var uint8Array = new Uint8Array(data)
  book.open(uint8Array,)
  rendition = book.renderTo("viewer", {
    manager: manager,
    flow: flow,
    // method: "continuous",
    spread: spread,
    width: "100vw",
    height: "100vh",
    snap: snap && !useCustomSwipe,
    allowScriptedContent: allowScriptedContent,
    defaultDirection: direction
  });



  // Wrap rendition.next/prev so we can globally block page turns when needed
  (function () {
    if (!rendition) return;

    var originalNext = rendition.next ? rendition.next.bind(rendition) : null;
    var originalPrev = rendition.prev ? rendition.prev.bind(rendition) : null;

    if (originalNext) {
      rendition.next = function () {
        if (!epubSwipeEnabled) {
          console.log('[EPUB] next blocked because swipe disabled');
          return;
        }
        return originalNext();
      };
    }

    if (originalPrev) {
      rendition.prev = function () {
        if (!epubSwipeEnabled) {
          console.log('[EPUB] prev blocked because swipe disabled');
          return;
        }
        return originalPrev();
      };
    }
  })();

  if (cfi) {
    displayed = rendition.display(cfi)
  } else {
    displayed = rendition.display()
  }

  // Attach vertical scroll listener for scrolled flows.
  // 在滚动模式下，真正滚动的是 epub.js 创建的 .epub-container 容器，
  // 而不是外层的 #viewer，因此这里显式对该容器添加监听并向 Flutter 上报。
  if (flow === 'scrolled' || flow === 'scrolled-doc' || flow === 'scrolled-continuous') {
    attachEpubScrollListener();
  }

  rendition.on("displayed", function (renderer) {
    window.flutter_inappwebview.callHandler('displayed');

    // Skip style fixing if we're in the middle of adding an underline or keyboard is visible
    if (isAddingUnderline) {
      return;
    }
  });





  // Handle selection clearing and changes
  rendition.hooks.content.register(function (contents) {



    let isIOS = detectIOS();

    console.log('[EPUB] isIOS: ', isIOS);

    if (isIOS) {
      function handlePointerDown(e) {

        pointerStartX = e.clientX;


      }

      function handleSelectionEnd(e) {
        var pointerMoved = Math.abs(e.clientX - pointerStartX);
        var cfiRange = getCfiFromSelection(contents);
        console.log('JS 手指抬起 [EPUB] cfiRange: 移动距离', cfiRange, pointerMoved);
        if (!cfiRange) {
          //这里如果没滑动，则让flutter toggle bars,否则不让toggle bars
          if (pointerMoved == 0) {
            clearSelection();
          }
          return;
        }
        sendSelectionData(cfiRange, contents, 'selectionChanging');
      }

      contents.document.addEventListener('pointerup', handleSelectionEnd, true);
      contents.document.addEventListener('pointerdown', handlePointerDown, true);

    } else {
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



    }




  });






  book.loaded.navigation.then(function (toc) {
    chapters = parseChapters(toc)
    window.flutter_inappwebview.callHandler('chapters');
  })



  rendition.on("rendered", function (section) {
    window.flutter_inappwebview.callHandler('rendered');

    // Skip style fixing if we're in the middle of adding an underline or keyboard is visible
    if (isAddingUnderline) {
      return;
    }
  })

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



  //book location changes callback
  rendition.on("relocated", function (location) {
    // Clear selection when navigating to a new page (if enabled)
    if (clearSelectionOnPageChange && flow === 'scrolled') {
      // Clear the actual browser selection across all iframe contents
      rendition.getContents().forEach(function (contents) {
        try {
          if (contents.window.getSelection) {
            contents.window.getSelection().removeAllRanges();
          }
        } catch (e) {
          // Ignore errors if iframe is not accessible
        }
      });

      // Notify Flutter that selection was cleared
      window.flutter_inappwebview.callHandler('selectionCleared');
    }

    var percent = location.start.percentage;
    var location = {
      startCfi: location.start.cfi,
      endCfi: location.end.cfi,
      progress: percent
    }
    var args = [location]
    window.flutter_inappwebview.callHandler('relocated', ...args);
  });

  rendition.on('displayError', function (e) {
    window.flutter_inappwebview.callHandler('displayError');
  })

  rendition.on('markClicked', function (cfiRange) {
    var args = [cfiRange.toString()]
    window.flutter_inappwebview.callHandler('markClicked', ...args);
  })

  book.ready.then(function () {
    book.locations.generate(1600).then(() => {
      if (cfi) {
        rendition.display(cfi)
      }
      window.flutter_inappwebview.callHandler('locationLoaded');
    })
  })

  rendition.hooks.content.register((contents) => {
    // Set up handler to fix underline elements
    var doc = contents.document;

    // Fix underline styles when content is loaded
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

    if (useCustomSwipe) {
      const el = contents.document.documentElement;

      if (el) {
        console.log('[EPUB] Attaching custom swipe handlers');
        detectSwipe(el, function (el, direction) {
          if (!epubSwipeEnabled) {
            console.log(
              '[EPUB] Swipe ignored because swipe disabled. dir=',
              direction,
            );
            return;
          }

          console.log('[EPUB] Detected swipe direction:', direction);
          window.flutter_inappwebview.callHandler('swipe', direction);

          if (direction == 'l') {
            console.log('[EPUB] Swipe left -> next page');
            rendition.next()
          }
          if (direction == 'r') {
            console.log('[EPUB] Swipe right -> previous page');
            rendition.prev()
          }
        });
      }
    }
  });
  rendition.themes.fontSize(fontSize + "px");
  //set background and foreground color
  updateTheme(backgroundColor, foregroundColor);

  if (fontFamily) {
    setFontFamily(fontFamily);
  }
  if (margin !== null && margin !== undefined) {
    setHorizontalMargin(margin);
  }
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

      console.log(
        '[EPUB] epub-container 滚动: scrollTop=',
        scrollTop,
        'max=',
        maxScrollTop,
        'dir=',
        direction
      );

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
  rendition.display(cfi)
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
  var percent = rendition.location.start.percentage;
  // var percentage = Math.floor(percent * 100);
  var location = {
    startCfi: rendition.location.start.cfi,
    endCfi: rendition.location.end.cfi,
    progress: percent
  }
  return location;
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


// adds highlight with given color
function addHighlight(cfiRange, color, opacity) {
  console.log('[EPUB] addHighlight: ', cfiRange, color, opacity);
  try {
    rendition.annotations.remove(cfiRange, "highlight");
  } catch (err) {
    // ignore if highlight doesn't exist yet
  }
  rendition.annotations.highlight(cfiRange, {}, (e) => {
    // console.log("highlight clicked", e.target);
  }, "hl", { "fill": color, "fill-opacity": '0.3', "mix-blend-mode": "multiply" });
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


function search(q) {
  return Promise.all(
    book.spine.spineItems.map(item => item.load(book.load.bind(book)).then(item.find.bind(item, q)).finally(item.unload.bind(item)))
  ).then(results => Promise.resolve([].concat.apply([], results)));
};

function setFontSize(fontSize) {
  rendition.themes.default({
    p: {
      // "margin": '10px',
      "font-size": `${fontSize}px`
    }
  });
}

function setSpread(spread) {
  rendition.spread(spread);
}

function setFlow(flow) {
  rendition.flow(flow);
}

function setManager(manager) {
  rendition.manager(manager);
}

function setFontSize(fontSize) {
  rendition.themes.fontSize(`${fontSize}px`);
  rendition.reportLocation();

  // Fix underlines after font size change (needs delay for re-rendering)
  setTimeout(function () {
    console.log('[EPUB] Re-fixing underlines after font size change...');
    for (var cfi in underlineAnnotations) {
      var annotation = underlineAnnotations[cfi];
      var style = underlineStyles[cfi];

      if (annotation && annotation.mark && annotation.mark.element) {
        var color = (style && style.color) || '#ff0000';
        var isDashed = (style && style.isDashed) || true;
        applyUnderlineStyles(annotation.mark.element, color, isDashed);
      }
    }
  }, 200);

  setTimeout(function () {
    for (var cfi in underlineAnnotations) {
      var annotation = underlineAnnotations[cfi];
      var style = underlineStyles[cfi];

      if (annotation && annotation.mark && annotation.mark.element) {
        var color = (style && style.color) || '#ff0000';
        var isDashed = (style && style.isDashed) || true;
        applyUnderlineStyles(annotation.mark.element, color, isDashed);
      }
    }
  }, 500);
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

///update theme
function updateTheme(backgroundColor, foregroundColor) {
  if (backgroundColor && foregroundColor) {
    rendition.themes.register("dark", { "body": { "background": backgroundColor, "color": foregroundColor } });
    rendition.themes.select("dark");
  }
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

function detectSwipe(el, func) {
  swipe_det = new Object();
  swipe_det.sX = 0;
  swipe_det.sY = 0;
  swipe_det.eX = 0;
  swipe_det.eY = 0;
  // Make thresholds a bit more forgiving for horizontal swipes
  var min_x = 30;  //min x swipe for horizontal swipe
  var max_x = 80;  //max x difference for vertical swipe
  var min_y = 40;  //min y swipe for vertical swipe
  var max_y = 80;  //max y difference for horizontal swipe
  var direc = "";
  ele = el
  ele.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    swipe_det.sX = t.screenX;
    swipe_det.sY = t.screenY;
  }, false);
  ele.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    swipe_det.eX = t.screenX;
    swipe_det.eY = t.screenY;
  }, false);
  ele.addEventListener('touchend', function (e) {
    //horizontal detection
    if ((((swipe_det.eX - min_x > swipe_det.sX) || (swipe_det.eX + min_x < swipe_det.sX)) && ((swipe_det.eY < swipe_det.sY + max_y) && (swipe_det.sY > swipe_det.eY - max_y)))) {
      if (swipe_det.eX > swipe_det.sX) direc = "r";
      else direc = "l";
    }
    //vertical detection
    if ((((swipe_det.eY - min_y > swipe_det.sY) || (swipe_det.eY + min_y < swipe_det.sY)) && ((swipe_det.eX < swipe_det.sX + max_x) && (swipe_det.sX > swipe_det.eX - max_x)))) {
      if (swipe_det.eY > swipe_det.sY) direc = "d";
      else direc = "u";
    }

    if (direc != "") {
      if (typeof func == 'function') func(el, direc);
    }
    direc = "";
  }, false);
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

function setHorizontalMargin(margin) {
  if (rendition && rendition.themes) {
    rendition.themes.default({
      "body": {
        "margin": `0 ${margin}px`
      }
    });
  }
}

function setFontFamily(fontFamily) {
  if (rendition && rendition.themes) {
    rendition.themes.font(fontFamily);
  }
}
