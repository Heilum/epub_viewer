import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../flutter_epub_viewer.dart';
import 'utils.dart';

import 'dart:convert';

/// Callback for text selection events with WebView-relative coordinates.
///
/// Provides precise positioning information for implementing custom selection UI.
/// All rectangles are relative to the WebView's coordinate system (not screen coordinates).
///
/// Parameters:
/// * [selectedText] - The text that was selected
/// * [cfiRange] - The EPUB CFI (Canonical Fragment Identifier) range for the selection
/// * [selectionRect] - The bounding rectangle of the selected text (WebView-relative)
/// * [viewRect] - The bounding rectangle of the entire WebView
typedef EpubSelectionCallback =
    void Function(String selectedText, String cfiRange, Rect selectionRect);

class EpubViewer extends StatefulWidget {
  const EpubViewer({
    super.key,
    required this.epubController,
    required this.epubSource,
    this.initialCfi,
    this.onChaptersLoaded,
    this.onEpubLoaded,
    this.onLocationLoaded,
    this.onFootNoteTap,
    this.onRelocated,
    //this.onTextSelected,
    this.displaySettings,
    this.selectionContextMenu,
    this.onAnnotationClicked,

    this.onSelectionChanging,
    this.onDeselection,
    this.suppressNativeContextMenu = false,
    this.clearSelectionOnPageChange = true,
    this.onSwipe,
    this.onScroll,
    this.onBlankAreaTap,
    this.pendingInitialSettings, // 新增这一行
  });

  //Epub controller to manage epub
  final EpubController epubController;

  ///Epub source, accepts url, file or assets
  ///opf format is not tested, use with caution
  final EpubSource epubSource;
  final Map<String, dynamic>? pendingInitialSettings; // 新增这三行

  ///Initial cfi string to  specify which part of epub to load initially
  ///if null, the first chapter will be loaded
  final String? initialCfi;

  ///Call back when epub is loaded and displayed
  final VoidCallback? onEpubLoaded;

  /// Callback when the location are generated for epub, progress will be only available after this
  final VoidCallback? onLocationLoaded;
  final void Function(String href)? onFootNoteTap; // Changed from onLinkPressed

  ///Call back when chapters are loaded
  final ValueChanged<List<EpubChapter>>? onChaptersLoaded;

  ///Call back when epub page changes
  final ValueChanged<EpubLocation>? onRelocated;

  ///Call back when text selection changes
  //final ValueChanged<EpubTextSelection>? onTextSelected;

  ///initial display settings
  final EpubDisplaySettings? displaySettings;

  ///Callback for handling annotation click (Highlight and Underline)
  final ValueChanged<String>? onAnnotationClicked;

  /// Context menu for text selection.
  /// If null, the default context menu will be used.
  final ContextMenu? selectionContextMenu;

  /// Whether to suppress the native context menu entirely.
  /// When true, no native context menu will be shown on text selection.
  /// Use with [onSelection] to implement custom selection UI.
  final bool suppressNativeContextMenu;

  final Function(String direction)? onSwipe;

  /// Callback when epub scrolls
  ///
  /// Only meaningful in scrolled flows. Provides the current vertical scroll
  /// position, the maximum scroll offset, and a direction string:
  /// - 'down'  : user scrolled towards the end of the document
  /// - 'up'    : user scrolled towards the beginning
  /// - 'none'  : scrollTop did not change since last event
  final void Function(double scrollTop, double maxScrollTop, String direction)?
  onScroll;

  /// Callback when user taps on blank area (not on text or links).
  ///
  /// Only fires in paginated mode on iOS when user taps on empty space
  /// without any active text selection. Use this to toggle UI chrome visibility.
  final VoidCallback? onBlankAreaTap;

  /// Callback when text is selected with WebView-relative coordinates.
  ///
  /// Fires when:
  /// * User completes initial text selection
  /// * User finishes dragging selection handles (after a 300ms debounce)
  ///
  /// Use this callback to display custom UI at the selection position.
  /// Coordinates are relative to the WebView, not the screen.
  ///
  /// See also:
  /// * [onSelectionChanging] - Called while user is actively dragging handles
  /// * [onDeselection] - Called when selection is cleared
  final EpubSelectionCallback? onSelectionChanging;

  /// Callback fired continuously while the user is dragging selection handles.
  ///
  /// This callback helps prevent UI flicker and performance issues by allowing you to
  /// hide custom selection UI while the user is actively adjusting the selection.
  /// Once dragging stops, [onSelection] will be called with the final selection.
  ///
  /// Typical usage:
  /// ```dart
  /// onSelectionChanging: () {
  ///   // Hide custom selection UI while user drags handles
  ///   setState(() => showSelectionMenu = false);
  /// }
  /// ```
  ///
  /// See also:
  /// * [onSelection] - Called when selection is finalized

  /// Callback when text selection is cleared.
  ///
  /// Fired when the user taps elsewhere or explicitly clears the selection.
  /// Use this to hide any custom selection UI.
  final VoidCallback? onDeselection;

  /// Whether to automatically clear text selection when navigating to a new page.
  ///
  /// When true (default), text selection will be cleared when the user navigates
  /// to a different page using next(), previous(), or toCfi(). This is the standard
  /// behavior in most e-reader applications.
  ///
  /// Set to false if you want to preserve selection across page changes, though
  /// note that the selection may not be visible on the new page.
  final bool clearSelectionOnPageChange;

  @override
  State<EpubViewer> createState() => _EpubViewerState();
}

class _EpubViewerState extends State<EpubViewer> {
  final GlobalKey webViewKey = GlobalKey();

  var selectedText = '';

  InAppWebViewController? webViewController;

  InAppWebViewSettings settings = InAppWebViewSettings(
    isInspectable: kDebugMode,
    javaScriptEnabled: true,
    mediaPlaybackRequiresUserGesture: false,
    transparentBackground: true,
    supportZoom: false,
    allowsInlineMediaPlayback: true,
    disableLongPressContextMenuOnLinks: true,
    iframeAllowFullscreen: true,
    allowsLinkPreview: false,
    verticalScrollBarEnabled: false,
    selectionGranularity: SelectionGranularity.CHARACTER,
    disableContextMenu: true, // Disable native context menu
    allowFileAccessFromFileURLs: true,
    allowUniversalAccessFromFileURLs: true,
  );

  @override
  void initState() {
    super.initState();
  }

  /// Build gesture recognizers for the underlying [InAppWebView].
  ///
  /// - 在滚动模式或垂直分页时，允许垂直拖动（向上/向下滑动）。
  /// - 在分页 + 横向轴时，允许水平拖动（左右翻页）。
  /// - 始终允许长按，用于文本选择等长按行为。
  Set<Factory<OneSequenceGestureRecognizer>> _buildGestureRecognizers() {
    final displaySettings = widget.displaySettings ?? EpubDisplaySettings();
    final flow = displaySettings.flow;
    final axis = displaySettings.axis;

    final recognizers = <Factory<OneSequenceGestureRecognizer>>{
      Factory<LongPressGestureRecognizer>(
        () => LongPressGestureRecognizer(
          duration: const Duration(milliseconds: 30),
        ),
      ),
    };

    // 垂直滚动或垂直分页：需要纵向拖动交给 WebView
    if (flow == EpubFlow.scrolled || axis == EpubAxis.vertical) {
      recognizers.add(
        Factory<VerticalDragGestureRecognizer>(
          () => VerticalDragGestureRecognizer(),
        ),
      );

      debugPrint('允许纵向拖动 added');
    }

    // 分页 + 横向轴：需要上下拖动选择文本
    // if (flow == EpubFlow.paginated && axis == EpubAxis.horizontal) {
    //   recognizers.add(
    //     Factory<VerticalDragGestureRecognizer>(
    //       () => VerticalDragGestureRecognizer(),
    //     ),
    //   );
    //   debugPrint('允许纵向拖动2 added');
    // }

    return recognizers;
  }

  void _handleSelectionChanging({
    required Map<String, dynamic>? rect,
    required String selectedText,
    required String cfi,
  }) {
    if (!mounted) return;

    try {
      final renderBox = context.findRenderObject() as RenderBox;
      final webViewSize = renderBox.size;

      if (rect == null) return;

      // Convert relative coordinates (0-1) to actual WebView coordinates
      final left = (rect['left'] as num).toDouble();
      final top = (rect['top'] as num).toDouble();
      final width = (rect['width'] as num).toDouble();
      final height = (rect['height'] as num).toDouble();

      final scaledRect = Rect.fromLTWH(
        left * webViewSize.width,
        top * webViewSize.height,
        width * webViewSize.width,
        height * webViewSize.height,
      );

      // Provide WebView-relative coordinates (not screen coordinates)
      widget.onSelectionChanging?.call(
        selectedText,
        cfi,
        scaledRect, // WebView-relative coordinates
      );
    } catch (e) {
      if (kDebugMode) {
        debugPrint("Error in _handleSelection: $e");
      }
    }
  }

  void addJavaScriptHandlers() {
    webViewController?.addJavaScriptHandler(
      handlerName: "footNoteTapped",
      callback: (data) {
        if (data.isNotEmpty) {
          widget.onFootNoteTap?.call(data[0].toString());
        }
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "displayed",
      callback: (data) {
        widget.onEpubLoaded?.call();
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "chapters",
      callback: (data) async {
        final chapters = await widget.epubController.parseChapters();
        widget.onChaptersLoaded?.call(chapters);
      },
    );

    // Add deselection handler
    webViewController?.addJavaScriptHandler(
      handlerName: 'selectionCleared',
      callback: (args) {
        widget.onDeselection?.call();
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: 'selectionChanging',
      callback: (args) {
        final selectedText = args[0] as String;
        final cfi = args[1] as String;
        final rect = args[2] as Map<String, dynamic>;
        _handleSelectionChanging(
          selectedText: selectedText,
          cfi: cfi,
          rect: rect,
        );
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "search",
      callback: (data) async {
        var searchResult = data[0];
        widget.epubController.searchResultCompleter.complete(
          List<EpubSearchResult>.from(
            searchResult.map((e) => EpubSearchResult.fromJson(e)),
          ),
        );
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "relocated",
      callback: (data) {
        var location = data[0];
        widget.onRelocated?.call(EpubLocation.fromJson(location));
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: 'locationLoaded',
      callback: (arguments) {
        widget.onLocationLoaded?.call();
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "readyToLoad",
      callback: (data) {
        loadBook();
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "markClicked",
      callback: (data) {
        String cfi = data[0];
        widget.onAnnotationClicked?.call(cfi);
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: "epubText",
      callback: (data) {
        var text = data[0].trim();
        var cfi = data[1];
        widget.epubController.pageTextCompleter.complete(
          EpubTextExtractRes(text: text, cfiRange: cfi),
        );
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: 'epubScroll',
      callback: (args) {
        if (widget.onScroll == null || args.isEmpty) {
          return;
        }

        final raw = args[0];
        if (raw is! Map) {
          return;
        }

        final payload = Map<String, dynamic>.from(raw);
        final scrollTop = (payload['scrollTop'] as num).toDouble();
        final maxScrollTop = (payload['maxScrollTop'] as num).toDouble();
        final direction = payload['direction'] as String? ?? 'none';

        widget.onScroll?.call(scrollTop, maxScrollTop, direction);
      },
    );

    webViewController?.addJavaScriptHandler(
      handlerName: 'blankAreaTap',
      callback: (args) {
        widget.onBlankAreaTap?.call();
      },
    );
  }

  Future<void> loadBook() async {
    var data = await widget.epubSource.epubData;
    final displaySettings = widget.displaySettings ?? EpubDisplaySettings();
    String manager = displaySettings.manager.name;
    String flow = displaySettings.flow.name;
    String spread = displaySettings.spread.name;
    String axis = displaySettings.axis.name;
    // 保持与原始 flutter_epub_viewer 一致：直接使用 displaySettings.snap
    //（在 paginated 模式下用于分页动画，在 scrolled 模式下无实际效果）
    bool snap = displaySettings.snap;
    bool allowScripted = displaySettings.allowScriptedContent;
    String cfi = widget.initialCfi ?? "";
    String direction =
        widget.displaySettings?.defaultDirection.name ??
        EpubDefaultDirection.ltr.name;
    int fontSize = displaySettings.fontSize;
    String? fontFamily = displaySettings.fontFamily;
    double? margin = displaySettings.horizontalMargin;

    // 与原始仓库保持一致：
    // 仅在 Android 且未启用 snap 动画时使用自定义 swipe，iOS 依赖 epub.js 自带的分页动画。
    bool useCustomSwipe = false;
    //  Platform.isAndroid && !displaySettings.useSnapAnimationAndroid;

    String? foregroundColor = widget.displaySettings?.theme?.foregroundColor
        ?.toHex();
    String? backgroundColor;
    final decoration = widget.displaySettings?.theme?.backgroundDecoration;
    if (decoration is BoxDecoration) {
      backgroundColor = decoration.color?.toHex();
    }

    bool clearSelectionOnPageChange = widget.clearSelectionOnPageChange;
    // Convert pendingInitialSettings to JSON string
    final settingsJson = widget.pendingInitialSettings != null
        ? jsonEncode(widget.pendingInitialSettings)
        : 'null';
    webViewController?.evaluateJavascript(
      source:
          'loadBook([${data.join(',')}], "$cfi", "$manager", "$flow", "$spread", $snap, $allowScripted, "$direction", $useCustomSwipe, "${backgroundColor ?? ''}", "$foregroundColor", "$fontSize", $clearSelectionOnPageChange, "$axis", ${fontFamily == null ? 'null' : '"$fontFamily"'}, ${margin ?? 'null'}, $settingsJson)',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: widget.displaySettings?.theme?.backgroundDecoration,
      child: InAppWebView(
        contextMenu: widget.suppressNativeContextMenu
            ? ContextMenu(
                menuItems: [],
                settings: ContextMenuSettings(
                  hideDefaultSystemContextMenuItems: true,
                ),
                onCreateContextMenu: (hitTestResult) async {
                  // Completely disable context menu
                },
              )
            : widget.selectionContextMenu,
        key: webViewKey,
        initialFile:
            'packages/flutter_epub_viewer/lib/assets/webpage/html/swipe.html',
        initialSettings: settings
          ..disableVerticalScroll = widget.displaySettings?.snap ?? false,
        onWebViewCreated: (controller) async {
          webViewController = controller;
          widget.epubController.setWebViewController(controller);
          addJavaScriptHandlers();
        },
        onLoadStart: (controller, url) {},
        onPermissionRequest: (controller, request) async {
          return PermissionResponse(
            resources: request.resources,
            action: PermissionResponseAction.GRANT,
          );
        },
        shouldOverrideUrlLoading: (controller, navigationAction) async {
          return NavigationActionPolicy.ALLOW;
        },
        onLoadStop: (controller, url) async {},
        onReceivedError: (controller, request, error) {},
        onProgressChanged: (controller, progress) {},
        onUpdateVisitedHistory: (controller, url, androidIsReload) {},
        onConsoleMessage: (controller, consoleMessage) {
          if (kDebugMode) {
            debugPrint("JS_LOG: ${consoleMessage.message}");
          }
        },
        gestureRecognizers: _buildGestureRecognizers(),
      ),
    );
  }

  @override
  void dispose() {
    webViewController?.dispose();
    super.dispose();
  }
}
