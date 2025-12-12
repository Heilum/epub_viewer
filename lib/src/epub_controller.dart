import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_epub_viewer/src/epub_metadata.dart';
import 'package:flutter_epub_viewer/src/models/epub_display_settings.dart';
import 'package:flutter_epub_viewer/src/models/epub_location.dart';
import 'package:flutter_epub_viewer/src/models/epub_search_result.dart';
import 'package:flutter_epub_viewer/src/models/epub_text_extract_res.dart';
import 'package:flutter_epub_viewer/src/utils.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'models/epub_chapter.dart';
import 'models/epub_theme.dart';

class EpubController {
  InAppWebViewController? webViewController;

  ///List of chapters from epub
  List<EpubChapter> _chapters = [];

  setWebViewController(InAppWebViewController controller) {
    webViewController = controller;
  }

  ///Move epub view to specific area using Cfi string or chapter href
  display({
    ///Cfi String of the desired location, also accepts chapter href
    required String cfi,
  }) {
    checkEpubLoaded();
    webViewController?.evaluateJavascript(source: 'toCfi("$cfi")');
  }

  ///Moves to next page in epub view
  next() {
    checkEpubLoaded();
    webViewController?.evaluateJavascript(source: 'next()');
  }

  ///Moves to previous page in epub view
  prev() {
    checkEpubLoaded();
    webViewController?.evaluateJavascript(source: 'previous()');
  }

  ///Returns current location of epub viewer
  Future<EpubLocation> getCurrentLocation() async {
    checkEpubLoaded();
    final result = await webViewController?.evaluateJavascript(
      source: 'getCurrentLocation()',
    );

    if (result == null) {
      throw Exception("Epub locations not loaded");
    }

    return EpubLocation.fromJson(result);
  }

  ///Returns list of [EpubChapter] from epub,
  /// should be called after onChaptersLoaded callback, otherwise returns empty list
  List<EpubChapter> getChapters() {
    checkEpubLoaded();
    return _chapters;
  }

  Future<List<EpubChapter>> parseChapters() async {
    if (_chapters.isNotEmpty) return _chapters;

    checkEpubLoaded();

    final result = await webViewController!.evaluateJavascript(
      source: 'getChapters()',
    );

    _chapters = parseChapterList(result);
    return _chapters;
  }

  Future<EpubMetadata> getMetadata() async {
    checkEpubLoaded();
    final result = await webViewController!.evaluateJavascript(
      source: 'getBookInfo()',
    );
    return EpubMetadata.fromJson(result);
  }

  Completer searchResultCompleter = Completer<List<EpubSearchResult>>();

  ///Search in epub using query string
  ///Returns a list of [EpubSearchResult]
  Future<List<EpubSearchResult>> search({
    ///Search query string
    required String query,
    // bool optimized = false,
  }) async {
    searchResultCompleter = Completer<List<EpubSearchResult>>();
    if (query.isEmpty) return [];
    checkEpubLoaded();
    await webViewController?.evaluateJavascript(
      source: 'searchInBook("$query")',
    );
    return await searchResultCompleter.future;
  }

  ///Adds a highlight to epub viewer
  addHighlight({
    ///Cfi string of the desired location
    required String cfi,

    ///Color of the highlight
    Color color = const Color(0xFFFF7300),

    ///Opacity of the highlight
    double opacity = 0.3,
  }) {
    var colorHex = color.toHex();
    var opacityString = opacity.toString();
    checkEpubLoaded();
    webViewController?.evaluateJavascript(
      source: 'addHighlight("$cfi", "$colorHex", "$opacityString")',
    );
  }

  ///Adds a underline annotation
  addUnderline({
    ///Cfi string of the desired location
    required String cfi,

    ///Color of the underline
    Color color = Colors.black,

    ///Whether to use dashed line style
    bool isDashed = false,
  }) {
    checkEpubLoaded();
    var colorHex = color.toHex();
    webViewController?.evaluateJavascript(
      source: 'addUnderLine("$cfi", "$colorHex", $isDashed)',
    );
  }

  ///Adds a mark annotation
  // addMark({
  //   ///Cfi string of the desired location
  //   required String cfi,
  //
  //   ///Color of the mark underline
  //   Color color = Colors.red,
  //
  //   ///Whether to use dashed line style
  //   bool isDashed = true,
  // }) {
  //   checkEpubLoaded();
  //   var colorHex = color.toHex();
  //   webViewController?.evaluateJavascript(
  //     source: 'addMark("$cfi", "$colorHex", $isDashed)',
  //   );
  // }

  ///Removes a highlight from epub viewer
  removeHighlight({required String cfi}) {
    checkEpubLoaded();
    webViewController?.evaluateJavascript(source: 'removeHighlight("$cfi")');
  }

  ///Removes a underline from epub viewer
  removeUnderline({required String cfi}) {
    checkEpubLoaded();
    webViewController?.evaluateJavascript(source: 'removeUnderLine("$cfi")');
  }

  ///Removes a mark from epub viewer
  // removeMark({required String cfi}) {
  //   checkEpubLoaded();
  //   webViewController?.evaluateJavascript(source: 'removeMark("$cfi")');
  // }

  ///Set [EpubSpread] value
  setSpread({required EpubSpread spread}) async {
    await webViewController?.evaluateJavascript(source: 'setSpread("$spread")');
  }

  ///Set [EpubFlow] value
  setFlow({required EpubFlow flow}) async {
    await webViewController?.evaluateJavascript(source: 'setFlow("$flow")');
  }

  ///Set [EpubManager] value
  setManager({required EpubManager manager}) async {
    await webViewController?.evaluateJavascript(
      source: 'setManager("$manager")',
    );
  }

  ///Adjust font size in epub viewer
  setFontSize({required double fontSize}) async {
    await webViewController?.evaluateJavascript(
      source: 'setFontSize("$fontSize")',
    );
  }

  ///Set horizontal margin in epub viewer
  setHorizontalMargin({required double margin}) async {
    await webViewController?.evaluateJavascript(
      source: 'setHorizontalMargin($margin)',
    );
  }

  ///Set line spacing in epub viewer
  setLineSpacing({required double spacing}) async {
    await webViewController?.evaluateJavascript(
      source: 'setLineSpacing($spacing)',
    );
  }

  ///Enable or disable swipe/page-turn in the underlying JS viewer.
  ///
  ///This uses the global `setSwipeEnabled` function defined in `epubView.js`
  ///to guard both custom swipe detection and `rendition.next/prev`.
  setSwipeEnabled({required bool enabled}) async {
    await webViewController?.evaluateJavascript(
      source: 'setSwipeEnabled(${enabled ? 'true' : 'false'})',
    );
  }

  ///Programmatically clear any current text selection inside the EPUB WebView.
  ///
  ///This calls the global `clearSelection()` function defined in `epubView.js`,
  ///which removes selection in all content iframes and notifies Flutter via
  ///the existing `selectionCleared` handler.
  clearSelection() async {
    await webViewController?.evaluateJavascript(source: 'clearSelection()');
  }

  updateTheme({required EpubTheme theme}) async {
    String? foregroundColor = theme.foregroundColor?.toHex();
    String backgroundColor = "";
    final decoration = theme.backgroundDecoration;
    if (decoration is BoxDecoration) {
      final color = decoration.color;
      if (color != null) {
        backgroundColor = color.toHex();
      }
    }
    await webViewController?.evaluateJavascript(
      source: 'updateTheme("$backgroundColor","$foregroundColor")',
    );
  }

  Completer<EpubTextExtractRes> pageTextCompleter =
      Completer<EpubTextExtractRes>();

  ///Extract text from a given cfi range,
  Future<EpubTextExtractRes> extractText({
    ///start cfi
    required startCfi,

    ///end cfi
    required endCfi,
  }) async {
    checkEpubLoaded();
    pageTextCompleter = Completer<EpubTextExtractRes>();
    await webViewController?.evaluateJavascript(
      source: 'getTextFromCfi("$startCfi","$endCfi")',
    );
    return pageTextCompleter.future;
  }

  ///Extracts text content from current page
  Future<EpubTextExtractRes> extractCurrentPageText() async {
    checkEpubLoaded();
    pageTextCompleter = Completer<EpubTextExtractRes>();
    await webViewController?.evaluateJavascript(source: 'getCurrentPageText()');
    return pageTextCompleter.future;
  }

  ///Given a percentage moves to the corresponding page
  ///Progress percentage should be between 0.0 and 1.0
  toProgressPercentage(double progressPercent) {
    assert(
      progressPercent >= 0.0 && progressPercent <= 1.0,
      'Progress percentage must be between 0.0 and 1.0',
    );
    checkEpubLoaded();
    webViewController?.evaluateJavascript(
      source: 'toProgress($progressPercent)',
    );
  }

  ///Moves to the first page of the epub
  moveToFistPage() {
    toProgressPercentage(0.0);
  }

  ///Moves to the last page of the epub
  moveToLastPage() {
    toProgressPercentage(1.0);
  }

  checkEpubLoaded() {
    if (webViewController == null) {
      throw Exception(
        "Epub viewer is not loaded, wait for onEpubLoaded callback",
      );
    }
  }

  ///Set font family in epub viewer
  setFontFamily({required EpubFontFamily fontFamily}) async {
    await webViewController?.evaluateJavascript(
      source: "setFontFamily('${fontFamily.cssValue}')",
    );
  }

  /// Get content of an element by URL (hash)
  Future<String?> getContentFromUrl(String url) async {
    checkEpubLoaded();
    final result = await webViewController?.evaluateJavascript(
      source: 'getContentFromUrl("$url")',
    );
    return result?.toString();
  }

  /// Get page number from CFI (1-based)
  Future<int> getPageNumberFromCfi(String cfi) async {
    checkEpubLoaded();
    final result = await webViewController?.evaluateJavascript(
      source: 'getPageNumberFromCfi("$cfi")',
    );
    print("getPageNumberFromCfi result: $result, type: ${result.runtimeType}");
    if (result is num) {
      return result.toInt();
    }
    return -1;
  }
}

enum EpubFontFamily {
  systemDefault, //FZYouHJW_508R.TTF
  fangzhengyasong, //FZZHUNYSJW.TTF
  fangzhengkaite, //FZKTJW.TTF
  fangzhenglanting; //FZLanTYJW_Zhun.TTF

  String get displayName {
    switch (this) {
      case EpubFontFamily.systemDefault:
        return '系统默认';
      case EpubFontFamily.fangzhengkaite:
        return '方正楷体';
      case EpubFontFamily.fangzhenglanting:
        return '方正兰亭圆';
      case EpubFontFamily.fangzhengyasong:
        return '方正雅宋';
    }
  }
}

extension EpubFontFamilyExtension on EpubFontFamily {
  String get cssValue {
    switch (this) {
      case EpubFontFamily.systemDefault:
        return 'PingFangSC-Regular';
      case EpubFontFamily.fangzhengkaite:
        return 'FZKTJW';
      case EpubFontFamily.fangzhenglanting:
        return 'FZLanTYJW_Zhun';
      case EpubFontFamily.fangzhengyasong:
        return 'FZZHUNYSJW';
    }
  }
}

class LocalServerController {
  final InAppLocalhostServer _localhostServer = InAppLocalhostServer(
    documentRoot: 'packages/flutter_epub_viewer/lib/assets/webpage',
  );

  Future<void> initServer() async {
    if (_localhostServer.isRunning()) return;
    await _localhostServer.start();
  }

  Future<void> disposeServer() async {
    if (!_localhostServer.isRunning()) return;
    await _localhostServer.close();
  }
}
