import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_annotation.dart';

class AnnotationManager extends ChangeNotifier {
  static const String _storageKey = 'epub_annotations';
  List<AppAnnotation> _annotations = [];
  SharedPreferences? _prefs;

  List<AppAnnotation> get annotations => List.unmodifiable(_annotations);

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    await loadAnnotations();
  }

  // Load annotations from storage
  Future<void> loadAnnotations() async {
    final jsonString = _prefs?.getString(_storageKey) ?? '';
    if (jsonString.isNotEmpty) {
      _annotations = AnnotationSerializer.decodeList(jsonString);
      notifyListeners();
    }
  }

  // Save annotations to storage
  Future<void> saveAnnotations() async {
    final jsonString = AnnotationSerializer.encodeList(_annotations);
    await _prefs?.setString(_storageKey, jsonString);
  }

  // Add a new annotation
  Future<void> addAnnotation(AppAnnotation annotation) async {
    _annotations.add(annotation);
    notifyListeners();
    await saveAnnotations();
  }

  // Remove annotation by ID
  Future<void> removeAnnotation(String id) async {
    _annotations.removeWhere((a) => a.id == id);
    notifyListeners();
    await saveAnnotations();
  }

  // Remove all annotations with specific CFI and type
  Future<void> removeAnnotationsByCfi(
    String cfi, {
    AnnotationType? type,
  }) async {
    if (type != null) {
      _annotations.removeWhere((a) => a.cfi == cfi && a.type == type);
    } else {
      _annotations.removeWhere((a) => a.cfi == cfi);
    }
    notifyListeners();
    await saveAnnotations();
  }

  // Get all annotations for a specific CFI
  List<AppAnnotation> getAnnotationsByCfi(String cfi) {
    return _annotations.where((a) => a.cfi == cfi).toList();
  }

  // Check if a CFI has highlight
  bool hasHighlight(String cfi) {
    return _annotations.any(
      (a) => a.cfi == cfi && a.type == AnnotationType.highlight,
    );
  }

  // Check if a CFI has notes
  bool hasNotes(String cfi) {
    return _annotations.any(
      (a) => a.cfi == cfi && a.myNote != null && a.myNote!.isNotEmpty,
    );
  }

  // Get all notes for a CFI
  List<AppAnnotation> getNotesByCfi(String cfi) {
    return _annotations
        .where((a) => a.cfi == cfi && a.myNote != null && a.myNote!.isNotEmpty)
        .toList();
  }

  // Clear all annotations
  Future<void> clearAll() async {
    _annotations.clear();
    notifyListeners();
    await saveAnnotations();
  }
}
