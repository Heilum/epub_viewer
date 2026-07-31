import 'package:json_annotation/json_annotation.dart';
import 'epub_theme.dart';

part 'epub_display_settings.g.dart';

@JsonSerializable(explicitToJson: true, includeIfNull: false)
class EpubDisplaySettings {
  /// Font size of the reader
  int fontSize;

  /// Page spread settings
  EpubSpread spread;

  /// Page flow settings
  EpubFlow flow;

  /// Default reading direction
  EpubDefaultDirection defaultDirection;

  /// Allow or disallow scripted content
  bool allowScriptedContent;

  /// Manager type
  EpubManager manager;

  /// Enables swipe between pages
  bool snap;

  ///Uses animation between page snapping when snap is true.
  /// **Warning:** Using this animation will break `onRelocated` callback
  final bool useSnapAnimationAndroid;

  /// Theme of the reader, by default it uses the book theme
  final EpubTheme? theme;

  /// Pagination axis (horizontal or vertical)
  final EpubAxis axis;

  /// Font family of the reader
  final String? fontFamily;

  /// Line height of the reader content, as a multiplier (e.g. 1.67)
  final double? lineSpacing;

  EpubDisplaySettings({
    this.fontSize = 15,
    this.spread = EpubSpread.auto,
    this.flow = EpubFlow.paginated,
    this.allowScriptedContent = false,
    this.defaultDirection = EpubDefaultDirection.ltr,
    this.snap = true,
    this.useSnapAnimationAndroid = false,
    this.manager = EpubManager.continuous,
    this.theme,
    this.axis = EpubAxis.horizontal,
    this.fontFamily,
    this.lineSpacing,
  });
  factory EpubDisplaySettings.fromJson(Map<String, dynamic> json) => _$EpubDisplaySettingsFromJson(json);
  Map<String, dynamic> toJson() => _$EpubDisplaySettingsToJson(this);
}

enum EpubSpread {
  ///Displays a single page in viewer
  none,

  ///Displays two pages in viewer
  always,

  ///Displays single or two pages in viewer depending on the device size
  auto,
}

enum EpubFlow {
  ///Displays contents page by page
  paginated,

  ///Displays contents in a single scroll view
  scrolled,
}

enum EpubDefaultDirection { ltr, rtl }

enum EpubManager {
  continuous,
  @JsonValue('default')
  defaultManager,
  // epub
}

enum EpubAxis {
  /// Horizontal pagination (left-right swipe)
  horizontal,

  /// Vertical pagination (up-down swipe)
  vertical,
}
