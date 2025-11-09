import 'dart:convert';

enum AnnotationType {
  highlight,
  note,
}

class AppAnnotation {
  final String id; // Unique identifier
  final String cfi; // CFI range
  final AnnotationType type;
  final String? myNote; // User's note text
  final DateTime createdAt;

  AppAnnotation({
    required this.id,
    required this.cfi,
    required this.type,
    this.myNote,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  // Convert to JSON for persistence
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'cfi': cfi,
      'type': type.name,
      'myNote': myNote,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  // Create from JSON
  factory AppAnnotation.fromJson(Map<String, dynamic> json) {
    return AppAnnotation(
      id: json['id'],
      cfi: json['cfi'],
      type: AnnotationType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => AnnotationType.note,
      ),
      myNote: json['myNote'],
      createdAt: DateTime.parse(json['createdAt']),
    );
  }

  // Copy with modifications
  AppAnnotation copyWith({
    String? id,
    String? cfi,
    AnnotationType? type,
    String? myNote,
    DateTime? createdAt,
  }) {
    return AppAnnotation(
      id: id ?? this.id,
      cfi: cfi ?? this.cfi,
      type: type ?? this.type,
      myNote: myNote ?? this.myNote,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  @override
  String toString() {
    return 'AppAnnotation(id: $id, cfi: $cfi, type: $type, note: $myNote)';
  }
}

// Helper functions for list serialization
class AnnotationSerializer {
  static String encodeList(List<AppAnnotation> annotations) {
    final list = annotations.map((a) => a.toJson()).toList();
    return jsonEncode(list);
  }

  static List<AppAnnotation> decodeList(String jsonString) {
    if (jsonString.isEmpty) return [];
    final list = jsonDecode(jsonString) as List;
    return list.map((json) => AppAnnotation.fromJson(json)).toList();
  }
}
