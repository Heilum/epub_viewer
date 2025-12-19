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

var isScrolling = false;
var scrollTimeout;
var lastDirection = 'none';



var wavyAnnotations = {};
var currentFlow = 'paginated'; // Track current flow
var currentMargin = 0; // Track current margin

let isSelecting = false;
let touchStartX = 0;
let touchStartY = 0;
let isDragging = false;

// Store initial CFI to restore after settings are applied
var initialCfi = null;




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



function loadBook(data, cfi, manager, flow, spread, snap, allowScriptedContent, direction, useCustomSwipe, backgroundColor, foregroundColor, fontSize, clearSelectionOnNav, axis, fontFamily, margin, pendingInitialSettings) {
  // Store the clearSelectionOnPageChange setting
  clearSelectionOnPageChange = clearSelectionOnNav !== undefined ? clearSelectionOnNav : true;
  var viewportHeight = window.innerHeight;
  document.getElementById('viewer').style.height = viewportHeight;

  // [NEW] Center the viewer content (important for paginated resized view)
  document.getElementById('viewer').style.display = 'flex';
  document.getElementById('viewer').style.flexDirection = 'column';
  document.getElementById('viewer').style.alignItems = 'center';
  document.getElementById('viewer').style.justifyContent = 'center'; // Optional, but good for vertical centering if needed

  // [NEW] Parse and store flow/margin
  currentFlow = parseFlow(flow);
  currentMargin = flow === 'scrolled' ? 0 : 20; //margin || 0;

  console.log('[EPUB] 初始cfi:', cfi);

  // [NEW] Pre-load font if specified to reduce wait time in book.ready
  var fontToPreload = (pendingInitialSettings && pendingInitialSettings.fontFamily) || fontFamily;
  if (fontToPreload) {
    console.log('[EPUB] Pre-loading font:', fontToPreload);
    loadFontAsDataURI(fontToPreload).catch(function (err) {
      console.warn('[EPUB] Font pre-load failed, will retry in book.ready:', err);
    });
  }

  var uint8Array = new Uint8Array(data)
  book.open(uint8Array,)
  rendition = book.renderTo("viewer", {
    manager: manager,
    flow: currentFlow,
    // method: "continuous",
    spread: spread,
    width: "100%", // Default to 100%
    height: "100%",
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



  // Store initial CFI for later restoration
  initialCfi = cfi;

  if (cfi) {
    displayed = rendition.display(cfi)
  } else {
    displayed = rendition.display()
  }

  // Attach vertical scroll listener for scrolled flows.
  // 在滚动模式下，真正滚动的是 epub.js 创建的 .epub-container 容器，
  // 而不是外层的 #viewer，因此这里显式对该容器添加监听并向 Flutter 上报。
  // Attach vertical scroll listener for scrolled flows.
  // 在滚动模式下，真正滚动的是 epub.js 创建的 .epub-container 容器，
  // 而不是外层的 #viewer，因此这里显式对该容器添加监听并向 Flutter 上报。
  if (currentFlow.indexOf('scrolled') > -1) {
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
        contents.document.addEventListener('touchstart', function (e) {
          const touch = e.touches[0];
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          isDragging = false;
          console.log('[EPUB] touchstart at', touchStartX, touchStartY);
        }, true);
        // touchmove: 检测是否拖动，只在拖动时阻止
        contents.document.addEventListener('touchmove', function (e) {
          if (isSelecting) {
            const touch = e.touches[0];
            const deltaX = Math.abs(touch.clientX - touchStartX);
            const deltaY = Math.abs(touch.clientY - touchStartY);
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
          if (isLinkClick) {
            // 检查是否是注脚链接
            if (target.href.indexOf('#') > -1 && target.href.indexOf('fn') > -1) {
              console.log('[EPUB] 注脚链接，直接处理');
              e.preventDefault();
              e.stopPropagation();

              // 直接调用 Flutter
              window.flutter_inappwebview.callHandler('footNoteTapped', target.href);

              if (isSelecting) {
                isSelecting = false;
              }
              isDragging = false;
              return;
            }

            // 其他链接
            console.log('[EPUB] 普通链接，不处理 touchend');
            if (isSelecting) {
              isSelecting = false;
            }
            isDragging = false;
          } else if (isSelecting && isDragging) {
            console.log('[EPUB] 拖动结束，阻止翻页');
            e.stopPropagation();
            e.preventDefault();
            isDragging = false;
          } else if (isSelecting && !isDragging) {
            console.log('[EPUB] 点击时清除选择1');
            isSelecting = false;
            clearSelection();
            isDragging = false;
          } else {
            console.log('[EPUB] 点击时清除选择2');
            isSelecting = false;
            clearSelection();
            isDragging = false;

          }
        }, true);

        /////////////////////////////////


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


        // function handlePointerDown(e) {

        //   pointerStartX = e.clientX;


        // }

        // function handleSelectionEnd(e) {
        //   var pointerMoved = Math.abs(e.clientX - pointerStartX);
        //   var cfiRange = getCfiFromSelection(contents);
        //   console.log('JS 手指抬起 [EPUB] cfiRange: 移动距离', cfiRange, pointerMoved);
        //   if (!cfiRange) {
        //     //这里如果没滑动，则让flutter toggle bars,否则不让toggle bars
        //     if (pointerMoved == 0) {
        //       clearSelection();
        //     }
        //     return;
        //   }
        //   sendSelectionData(cfiRange, contents, 'selectionChanging');
        // }

        // contents.document.addEventListener('pointerup', handleSelectionEnd, true);
        // contents.document.addEventListener('pointerdown', handlePointerDown, true);

      }


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


    // [NEW] Fix wavy annotations on render
    setTimeout(function () { fixWavyAnnotations(); }, 100);
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

    console.log('[EPUB] relocated: ', location);

    // Clear selection when navigating to a new page (if enabled)
    if (clearSelectionOnPageChange && currentFlow.indexOf('scrolled') > -1) {
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


    // [NEW] Fix wavy annotations on relocation
    setTimeout(function () { fixWavyAnnotations(); }, 100);
  });

  rendition.on('displayError', function (e) {
    window.flutter_inappwebview.callHandler('displayError');
  })

  rendition.on('markClicked', function (cfiRange) {
    var args = [cfiRange.toString()]
    window.flutter_inappwebview.callHandler('markClicked', ...args);
  })

  book.ready.then(async function () {
    console.log('[EPUB] Book ready, applying initial settings');

    // Apply initial settings from pendingInitialSettings or function parameters
    // Priority: pendingInitialSettings > function parameters

    var finalFontSize = (pendingInitialSettings && pendingInitialSettings.fontSize) || fontSize;
    var finalFontFamily = (pendingInitialSettings && pendingInitialSettings.fontFamily) || fontFamily;
    var finalLineSpacing = (pendingInitialSettings && pendingInitialSettings.lineSpacing);
    var finalTheme = (pendingInitialSettings && pendingInitialSettings.theme);
    var finalBgColor = (finalTheme && finalTheme.backgroundColor) || backgroundColor;
    var finalFgColor = (finalTheme && finalTheme.foregroundColor) || foregroundColor;

    // Apply fontSize first (synchronous)
    if (finalFontSize) {
      console.log('[EPUB] Setting initial fontSize:', finalFontSize);
      rendition.themes.fontSize(finalFontSize + "px");
      currentFontSize = parseInt(finalFontSize) || 20;
    }

    // Apply theme (synchronous)
    if (finalBgColor && finalFgColor) {
      console.log('[EPUB] Setting initial theme:', finalBgColor, finalFgColor);
      updateTheme(finalBgColor, finalFgColor);
    }

    // Apply fontFamily (ASYNC - wait for font to load into cache)
    if (finalFontFamily) {
      console.log('[EPUB] Setting initial fontFamily:', finalFontFamily);
      try {
        // First, ensure font is loaded into cache
        var dataURI = await loadFontAsDataURI(finalFontFamily);
        console.log('[EPUB] Font loaded into cache:', finalFontFamily);

        // Update currentFontFamily so hooks.content.register will use it
        currentFontFamily = finalFontFamily;

        // Apply font theme (this sets the CSS font-family)
        if (rendition && rendition.themes) {
          rendition.themes.font(finalFontFamily);
          console.log('[EPUB] Font theme applied:', finalFontFamily);
        }

        // Inject font into any existing views
        if (rendition && rendition.views) {
          var views = rendition.views();
          console.log('[EPUB] Injecting font into', views.length, 'existing views');
          views.forEach(function (view) {
            if (view.document) {
              injectFontFace(view.document, finalFontFamily, dataURI);
            }
          });
        }

        // Force a re-render to ensure font is applied
        // This is important because views might have been created before font was loaded
        setTimeout(function () {
          if (rendition && rendition.reportLocation) {
            rendition.reportLocation();
            console.log('[EPUB] Triggered re-render for font application');
          }
        }, 100);

        console.log('[EPUB] Font family applied successfully');
      } catch (err) {
        console.error('[EPUB] Failed to apply font family:', err);
        // Still try to set the font family even if loading failed
        currentFontFamily = finalFontFamily;
        if (rendition && rendition.themes) {
          rendition.themes.font(finalFontFamily);
        }
      }
    }

    // Apply lineSpacing after font is loaded (synchronous)
    if (finalLineSpacing) {
      console.log('[EPUB] Setting initial lineSpacing:', finalLineSpacing);
      setLineSpacing(finalLineSpacing);
    }

    // Clear pending settings
    pendingInitialSettings = null;

    console.log('[EPUB] All initial settings applied');

    // [NEW] Restore initial CFI after all settings are applied
    // This prevents position drift caused by layout changes from font/spacing settings
    if (initialCfi) {
      console.log('[EPUB] Restoring initial CFI after settings:', initialCfi);
      setTimeout(function () {
        rendition.display(initialCfi);
        console.log('[EPUB] CFI restored');
      }, 200); // Wait for layout to stabilize
    }
  }).catch(function (err) {
    console.error('[EPUB] Error in book.ready:', err);
  });

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
  // Set default theme styles (footnotes, endnotes styling)
  // Note: fontSize, fontFamily, and colors will be applied in book.ready
  rendition.themes.default({
    'aside[epub\\:type="footnote"]': {
      'display': 'none !important'
    },
    'aside[epub\\:type~="footnote"]': {
      'display': 'none !important'
    },
    'aside[epub\\:type="endnote"]': {
      'display': 'none !important'
    },
    'aside[epub\\:type~="endnote"]': {
      'display': 'none !important'
    },
    'aside[role="doc-footnote"]': {
      'display': 'none !important'
    },
    'aside[role="doc-endnote"]': {
      'display': 'none !important'
    },
    'sup': {
      'color': '#FF7300 !important'
    },
    'a[epub\\:type="noteref"]': {
      'color': '#FF7300 !important',
      'text-decoration': 'none !important'
    }
  });

  // Apply margin (using stored currentMargin)
  setHorizontalMargin(currentMargin);

  // [NEW] Handle window resize (orientation change)
  window.addEventListener('resize', function () {
    // Debounce resize
    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(function () {
      // Re-apply margin logic which uses window dimensions
      if (currentFlow === 'paginated') {
        setHorizontalMargin(currentMargin);
      }
    }, 200);
  });
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
  // Re-apply margin logic for the new flow
  setHorizontalMargin(currentMargin);
}

function setManager(manager) {
  rendition.manager(manager);
}



function setFontSize(fontSize) {
  currentFontSize = parseInt(fontSize) || 20;

  // Update theme immediately
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
    // ... existing underline loop ...
    fixWavyAnnotations(); // [NEW]
  }, 500);

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


// Global style state
var currentFontSize = 20;
var currentLineSpacing = 1.2; // Default approx line height
var currentFontFamily = 'PingFangSC-Regular'; // Default

function setHorizontalMargin(margin) {
  // currentMargin = margin;
  // if (!rendition) return;

  // if (currentFlow === 'paginated') {
  //   console.log('[EPUB] Applying Paginated Margin:', margin);
  //   // For paginated, we resize the rendition to create real whitespace outside the content.
  //   // This allows epub.js to paginate correctly within the narrower width.
  //   var newWidth = window.innerWidth - (2 * margin);
  //   rendition.resize(newWidth, window.innerHeight);

  //   // Clear any body padding that might have been set by scrolled mode
  //   if (rendition.themes) {
  //     rendition.themes.register("margin", { "body": { "padding": "0px !important", "box-sizing": "border-box !important" } });
  //     rendition.themes.select("margin");
  //   }

  // } else {
  //   // Scrolled flows
  //   console.log('[EPUB] Applying Scrolled Margin:', margin);
  //   // Reset to full size
  //   rendition.resize('100%', '100%');

  //   // Use body padding
  //   if (rendition.themes) {
  //     rendition.themes.register("margin", {
  //       "body": {
  //         "padding": `0 ${margin}px !important`,
  //         "box-sizing": "border-box !important"
  //       }
  //     });
  //     rendition.themes.select("margin");
  //   }
  // }
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

function setLineSpacing(spacing) {
  currentLineSpacing = parseFloat(spacing) || 1.2;

  if (rendition && rendition.themes) {
    rendition.themes.register("line_spacing", {
      "body": {
        "line-height": `${spacing} !important`
      },
      "p": {
        "line-height": `${spacing} !important`
      },
      "div": {
        "line-height": `${spacing} !important`
      }
    });
    rendition.themes.select("line_spacing");
  }
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

function setFontFamily(fontFamily) {
  console.log('[EPUB] setFontFamily:', fontFamily);
  currentFontFamily = fontFamily;

  // Return a Promise so callers can await font loading
  return loadFontAsDataURI(fontFamily).then(dataURI => {
    if (rendition && rendition.themes) {
      // Inject font into all current views
      var views = rendition.views();
      views.forEach(function (view) {
        if (view.document) {
          injectFontFace(view.document, fontFamily, dataURI);
        }
      });
      // Set default font on body
      rendition.themes.font(fontFamily);
      console.log('[EPUB] Font family set:', fontFamily);
    }
  }).catch(err => {
    console.error("[EPUB] Font load failed, applying anyway", err);
    // Still try to apply the font even if loading failed
    if (rendition && rendition.themes) {
      rendition.themes.font(fontFamily);
    }
    // Re-throw to let caller know there was an issue
    throw err;
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
