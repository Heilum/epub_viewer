var book = ePub();
var rendition;
var displayed;
var chapters = []
var clearSelectionOnPageChange = true; // Global flag for selection clearing behavior
// ========================================
// Custom Underline System (v4) - Optimized for Paginated Mode
// ========================================
// Uses custom <span> elements instead of EPUB.js annotations
// In paginated mode, DOM is stable - no need for complex re-rendering
var customUnderlines = {}; // Store: { cfi: { color, isDashed, spans: [], className, rendered } }



function loadBook(data, cfi, manager, flow, spread, snap, allowScriptedContent, direction, useCustomSwipe, backgroundColor, foregroundColor, fontSize, clearSelectionOnNav, axis) {
  // Store the clearSelectionOnPageChange setting
  clearSelectionOnPageChange = clearSelectionOnNav !== undefined ? clearSelectionOnNav : true;
  var viewportHeight = window.innerHeight;
  document.getElementById('viewer').style.height = viewportHeight;
  var uint8Array = new Uint8Array(data)
  book.open(uint8Array,)

  // Determine axis (default to horizontal if not specified)
  var paginationAxis = axis || 'horizontal';
  
  console.log('[EPUB][loadBook] Parameters:', {
    flow: flow,
    axis: axis,
    paginationAxis: paginationAxis,
    manager: manager,
    spread: spread,
    snap: snap
  });

  rendition = book.renderTo("viewer", {
    manager: manager,
    flow: flow,
    // method: "continuous",
    spread: spread,
    width: "100vw",
    height: "100vh",
    snap: snap && !useCustomSwipe,
    allowScriptedContent: allowScriptedContent,
    defaultDirection: direction,
    axis: paginationAxis  // Add axis parameter
  });
  
  console.log('[EPUB][loadBook] Rendition created with axis:', paginationAxis);

  if (cfi) {
    displayed = rendition.display(cfi)
  } else {
    displayed = rendition.display()
  }

  rendition.on("displayed", function (renderer) {
    window.flutter_inappwebview.callHandler('displayed');
    // In paginated mode, DOM is stable - no need to re-render
  });

  // Selection state tracking
  var selectionTimeout = null;
  var isSelecting = false;
  var lastCfiRange = null;

  // Handle selection clearing and changes
  rendition.hooks.content.register(function (contents) {
    contents.window.document.addEventListener('selectionchange', function () {
      var selection = contents.window.getSelection();
      var selectedText = selection.toString();

      if (!selectedText) {
        // Selection cleared
        isSelecting = false;
        lastCfiRange = null;
        if (selectionTimeout) {
          clearTimeout(selectionTimeout);
          selectionTimeout = null;
        }
        window.flutter_inappwebview.callHandler('selectionCleared');
      } else if (isSelecting) {
        // Selection is being modified (dragging handles)
        // Notify Flutter to hide the widget
        window.flutter_inappwebview.callHandler('selectionChanging');

        // Clear existing timeout
        if (selectionTimeout) {
          clearTimeout(selectionTimeout);
        }

        // Set timeout to detect when dragging stops
        selectionTimeout = setTimeout(function () {
          // Selection has stabilized, send the final selection
          if (lastCfiRange) {
            sendSelectionData(lastCfiRange, contents);
          }
          isSelecting = false;
        }, 300); // 300ms debounce
      }
    });
  });

  book.loaded.navigation.then(function (toc) {
    chapters = parseChapters(toc)
    window.flutter_inappwebview.callHandler('chapters');
  })

  rendition.on("rendered", function (section) {
    window.flutter_inappwebview.callHandler('rendered');
    // In paginated mode, DOM is stable - no need to check or re-render
  })

  // Function to calculate and send selection data
  function sendSelectionData(cfiRange, contents) {
    book.getRange(cfiRange).then(function (range) {
      var selectedText = range.toString();

      try {
        // Get selection coordinates
        var selection = contents.window.getSelection();
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

        var args = [cfiRange.toString(), selectedText, rect];
        window.flutter_inappwebview.callHandler('selection', ...args);
      } catch (e) {
        // Still send the selection without coordinates if there's an error
        var args = [cfiRange.toString(), selectedText, null];
        window.flutter_inappwebview.callHandler('selection', ...args);
      }
    });
  }

  ///text selection callback
  rendition.on("selected", function (cfiRange, contents) {
    lastCfiRange = cfiRange;

    if (!isSelecting) {
      // Initial selection - send immediately
      isSelecting = true;
      sendSelectionData(cfiRange, contents);
    }
    // If already selecting, the selectionchange handler will debounce it
  });

  //book location changes callback
  rendition.on("relocated", function (location) {
    // Clear selection when navigating to a new page (if enabled)
    if (clearSelectionOnPageChange && (isSelecting || lastCfiRange)) {
      isSelecting = false;
      lastCfiRange = null;
      if (selectionTimeout) {
        clearTimeout(selectionTimeout);
        selectionTimeout = null;
      }

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
        // console.log('EPUB_TEST_HOOK_IF')
        detectSwipe(el, function (el, direction) {
          // console.log("EPUB_TEST_DIR"+direction.toString())

          if (direction == 'l') {
            rendition.next()
          }
          if (direction == 'r') {
            rendition.prev()
          }
        });
      }
    }
  });
  rendition.themes.fontSize(fontSize + "px");
  //set background and foreground color
  updateTheme(backgroundColor, foregroundColor);
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
  try {
    rendition.annotations.remove(cfiRange, "highlight");
  } catch (err) {
    // ignore if highlight doesn't exist yet
  }
  rendition.annotations.highlight(cfiRange, {}, (e) => {
    // console.log("highlight clicked", e.target);
  }, "hl", { "fill": color, "fill-opacity": '0.3', "mix-blend-mode": "multiply" });
}

// ========================================
// Custom Underline Implementation
// ========================================

// Generate a unique class name for a CFI
function getUnderlineClassName(cfiString) {
  var hash = 0;
  for (var i = 0; i < cfiString.length; i++) {
    var char = cfiString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'custom-underline-' + Math.abs(hash);
}

// Add custom underline to a CFI range
function addUnderLine(cfiString, color, isDashed) {
  console.log('[EPUB][custom_v4] addUnderLine:', cfiString);

  var underlineColor = color || '#ff0000';
  var className = getUnderlineClassName(cfiString);

  // If already exists, just update style
  if (customUnderlines[cfiString]) {
    console.log('[EPUB][custom_v4] Underline exists, updating style');
    customUnderlines[cfiString].color = underlineColor;
    customUnderlines[cfiString].isDashed = isDashed;
    updateUnderlineStyle(cfiString);
    return;
  }

  // Store the underline data
  customUnderlines[cfiString] = {
    color: underlineColor,
    isDashed: isDashed,
    spans: [],
    className: className,
    rendered: false
  };

  // In paginated mode, render immediately - DOM is stable
  tryRenderUnderline(cfiString);
}

// Try to render an underline
function tryRenderUnderline(cfiString) {
  var underline = customUnderlines[cfiString];
  if (!underline || underline.rendered) return;

  try {
    // In paginated mode, no need to save/restore scroll position
    var range = rendition.getRange(cfiString);
    if (!range) {
      console.log('[EPUB][custom_v4] Range not available for:', cfiString);
      return;
    }

    // Check if the range is actually in the DOM
    if (!range.startContainer || !range.startContainer.ownerDocument) {
      console.log('[EPUB][custom_v4] Range not in DOM:', cfiString);
      return;
    }

    // Wrap the range content with spans
    var spans = wrapRangeWithSpans(range, underline.className, cfiString);

    // Update the underline data
    underline.spans = spans;
    underline.rendered = true;

    // Apply the style
    updateUnderlineStyle(cfiString);

    console.log('[EPUB][custom_v4] Rendered underline with', spans.length, 'spans');
  } catch (e) {
    console.log('[EPUB][custom_v4] Cannot render:', e.message);
  }
}

// Removed renderPendingUnderlines() and checkAndRerenderUnderlines() - not needed in paginated mode

// Wrap a range with span elements
function wrapRangeWithSpans(range, className, cfiString) {
  var spans = [];

  try {
    var span = document.createElement('span');
    span.className = className;
    span.setAttribute('data-cfi', cfiString);
    span.style.cursor = 'pointer';

    // Add click handler
    span.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      console.log('[EPUB][custom_v4] Underline clicked:', cfiString);
      window.flutter_inappwebview.callHandler('markClicked', cfiString);
    });

    // Wrap the range
    try {
      range.surroundContents(span);
      spans.push(span);
    } catch (e) {
      // If surroundContents fails, try extracting and inserting
      console.log('[EPUB][custom_v4] surroundContents failed, using extractContents');
      var fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
      spans.push(span);
    }
  } catch (e) {
    console.log('[EPUB][custom_v4] Error wrapping range:', e);
  }

  return spans;
}

// Update the visual style of an underline
function updateUnderlineStyle(cfiString) {
  var underline = customUnderlines[cfiString];
  if (!underline) return;

  var borderStyle = underline.isDashed
    ? '2px dashed ' + underline.color
    : '2px solid ' + underline.color;

  underline.spans.forEach(function (span) {
    if (span && span.style) {
      span.style.borderBottom = borderStyle;
    }
  });
}

function addMark(cfiString) {
  rendition.annotations.mark(cfiString)
}

function removeHighlight(cfiString) {
  rendition.annotations.remove(cfiString, "highlight");
}

// Remove a custom underline
function removeUnderLine(cfiString) {
  console.log('[EPUB][custom_v4] removeUnderLine:', cfiString);

  var underline = customUnderlines[cfiString];
  if (!underline) {
    console.log('[EPUB][custom_v4] Underline not found');
    return;
  }

  // Unwrap all spans
  underline.spans.forEach(function (span) {
    if (span && span.parentNode) {
      // Move children out of span
      while (span.firstChild) {
        span.parentNode.insertBefore(span.firstChild, span);
      }
      // Remove the span
      span.parentNode.removeChild(span);

      // Normalize the parent to merge adjacent text nodes
      span.parentNode.normalize();
    }
  });

  // Remove from storage
  delete customUnderlines[cfiString];

  console.log('[EPUB][custom_v4] Removed underline');
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
  var min_x = 50;  //min x swipe for horizontal swipe
  var max_x = 40;  //max x difference for vertical swipe
  var min_y = 40;  //min y swipe for vertical swipe
  var max_y = 50;  //max y difference for horizontal swipe
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
