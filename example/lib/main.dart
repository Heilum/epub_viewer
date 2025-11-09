import 'package:flutter/material.dart';
import 'package:flutter_epub_viewer/flutter_epub_viewer.dart';
import 'package:uuid/uuid.dart';

import 'annotation_manager.dart';
import 'app_annotation.dart';
import 'chapter_drawer.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const MyHomePage(title: 'Epub Viewer Demo'),
    );
  }
}

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});

  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  final epubController = EpubController();
  final annotationManager = AnnotationManager();
  final uuid = const Uuid();

  var textSelectionCfi = '';
  var selectedText = '';

  bool isLoading = true;
  double progress = 0.0;
  int fontSize = 16;
  
  // Debouncing for annotation clicks
  String? _lastClickedCfi;
  DateTime? _lastClickTime;

  @override
  void initState() {
    super.initState();
    _initAnnotations();
  }

  Future<void> _initAnnotations() async {
    await annotationManager.init();
    // Restore annotations when epub is loaded
    annotationManager.addListener(_onAnnotationsChanged);
  }

  void _onAnnotationsChanged() {
    setState(() {});
  }

  @override
  void dispose() {
    annotationManager.removeListener(_onAnnotationsChanged);
    super.dispose();
  }

  // Show dialog to input note
  Future<String?> _showNoteDialog({String? initialNote}) async {
    final controller = TextEditingController(text: initialNote);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('做笔记'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: '输入笔记内容...',
            border: OutlineInputBorder(),
          ),
          maxLines: 5,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }

  // Show list of notes for a CFI
  Future<void> _showNotesListDialog(String cfi) async {
    final notes = annotationManager.getNotesByCfi(cfi);
    if (notes.isEmpty) return;

    await showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('笔记列表'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: notes.length,
            itemBuilder: (context, index) {
              final note = notes[index];
              return Card(
                child: ListTile(
                  title: Text(note.myNote ?? ''),
                  subtitle: Text(
                    '创建时间: ${note.createdAt.toString().substring(0, 19)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete),
                    onPressed: () async {
                      // Remove the annotation
                      await annotationManager.removeAnnotation(note.id);

                      // Check if there are remaining notes for this CFI
                      final remaining = annotationManager.getNotesByCfi(cfi);

                      // Remove the underline
                      await epubController.removeUnderline(cfi: cfi);

                      // If there are still notes, re-add the underline
                      if (remaining.isNotEmpty) {
                        epubController.addUnderline(
                          cfi: cfi,
                          color: Colors.red,
                          isDashed: true,
                        );
                      }

                      // Close dialog if no more notes
                      if (remaining.isEmpty) {
                        Navigator.pop(context);
                      } else {
                        // Refresh the dialog
                        Navigator.pop(context);
                        _showNotesListDialog(cfi);
                      }
                    },
                  ),
                ),
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }

  // Add note annotation
  Future<void> _addNoteAnnotation() async {
    if (textSelectionCfi.isEmpty) return;

    final noteText = await _showNoteDialog();
    if (noteText == null || noteText.isEmpty) return;

    // Check if this CFI already has notes
    final hasExistingNotes = annotationManager.hasNotes(textSelectionCfi);

    // Create annotation
    final annotation = AppAnnotation(
      id: uuid.v4(),
      cfi: textSelectionCfi,
      type: AnnotationType.note,
      myNote: noteText,
    );

    // Save to manager
    await annotationManager.addAnnotation(annotation);

    // Add visual underline (only if not already present)
    if (!hasExistingNotes) {
      epubController.addUnderline(
        cfi: textSelectionCfi,
        color: Colors.red,
        isDashed: true,
      );
    }

    setState(() {});
  }

  // Add highlight annotation
  Future<void> _addHighlightAnnotation() async {
    if (textSelectionCfi.isEmpty) return;

    final annotation = AppAnnotation(
      id: uuid.v4(),
      cfi: textSelectionCfi,
      type: AnnotationType.highlight,
    );

    await annotationManager.addAnnotation(annotation);
    epubController.addHighlight(cfi: textSelectionCfi);

    setState(() {});
  }

  // Remove highlight annotation
  Future<void> _removeHighlightAnnotation() async {
    if (textSelectionCfi.isEmpty) return;

    await annotationManager.removeAnnotationsByCfi(
      textSelectionCfi,
      type: AnnotationType.highlight,
    );
    epubController.removeHighlight(cfi: textSelectionCfi);

    setState(() {});
  }

  // Build context menu items dynamically
  List<ContextMenuItem> _buildContextMenuItems() {
    final items = <ContextMenuItem>[];
    final hasHighlight = annotationManager.hasHighlight(textSelectionCfi);

    if (hasHighlight) {
      // If already highlighted, show "取消高亮"
      items.add(
        ContextMenuItem(
          title: "取消高亮",
          id: 1,
          action: _removeHighlightAnnotation,
        ),
      );
    } else {
      // Otherwise show "高亮"
      items.add(
        ContextMenuItem(
          title: "高亮",
          id: 2,
          action: _addHighlightAnnotation,
        ),
      );
    }

    // Always show "做笔记"
    items.add(
      ContextMenuItem(
        title: "做笔记",
        id: 3,
        action: _addNoteAnnotation,
      ),
    );

    return items;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: ChapterDrawer(controller: epubController),
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        title: Text(widget.title),
        actions: [
          TextButton(
            onPressed: () {
              setState(() {
                fontSize = fontSize == 16 ? 35 : 16;
              });
              epubController.setFontSize(fontSize: fontSize.toDouble());
            },
            child: const Text('改字体'),
          ),
          // Debug: Clear all annotations
          IconButton(
            icon: const Icon(Icons.clear_all),
            tooltip: '清除所有标注',
            onPressed: () async {
              // Show confirmation dialog
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('确认'),
                  content: const Text('确定要清除所有标注吗？此操作不可恢复。'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('取消'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('确定'),
                    ),
                  ],
                ),
              );

              if (confirmed == true) {
                // Get all CFIs before clearing
                final highlightCfis = annotationManager.annotations
                    .where((a) => a.type == AnnotationType.highlight)
                    .map((a) => a.cfi)
                    .toSet();
                final noteCfis = annotationManager.annotations
                    .where((a) => a.type == AnnotationType.note)
                    .map((a) => a.cfi)
                    .toSet();

                // Clear from storage
                await annotationManager.clearAll();

                // Remove visual annotations
                for (final cfi in highlightCfis) {
                  epubController.removeHighlight(cfi: cfi);
                }
                for (final cfi in noteCfis) {
                  epubController.removeUnderline(cfi: cfi);
                }

                setState(() {});
              }
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.transparent,
            ),
            Expanded(
              child: Stack(
                children: [
                  EpubViewer(
                    epubSource: EpubSource.fromAsset(
                      'assets/epubs/test.epub',
                    ),
                    epubController: epubController,
                    displaySettings: EpubDisplaySettings(
                      fontSize: fontSize,
                      flow: EpubFlow.scrolled,
                      useSnapAnimationAndroid: false,
                      snap: true,
                      theme: EpubTheme.light(),
                      allowScriptedContent: true,
                    ),
                    selectionContextMenu: ContextMenu(
                      menuItems: _buildContextMenuItems(),
                      settings: ContextMenuSettings(
                        hideDefaultSystemContextMenuItems: true,
                      ),
                    ),
                    onChaptersLoaded: (chapters) {
                      setState(() {
                        isLoading = false;
                      });
                    },
                    onEpubLoaded: () async {
                      print('Epub loaded');
                      // Restore all annotations
                      final noteCfis = <String>{};

                      for (final annotation in annotationManager.annotations) {
                        if (annotation.type == AnnotationType.highlight) {
                          epubController.addHighlight(
                            cfi: annotation.cfi,
                            color: Colors.yellow,
                          );
                        } else if (annotation.type == AnnotationType.note) {
                          // Only add underline once per CFI
                          if (!noteCfis.contains(annotation.cfi)) {
                            noteCfis.add(annotation.cfi);
                            epubController.addUnderline(
                              cfi: annotation.cfi,
                              color: Colors.red,
                              isDashed: true,
                            );
                          }
                        }
                      }
                    },
                    onRelocated: (value) {
                      print("Reloacted to $value");
                      setState(() {
                        progress = value.progress;
                      });
                    },
                    onAnnotationClicked: (cfi) {
                      print("Annotation clicked: $cfi");
                      
                      // Debounce: prevent duplicate clicks within 300ms
                      final now = DateTime.now();
                      if (_lastClickedCfi == cfi && _lastClickTime != null) {
                        final diff = now.difference(_lastClickTime!).inMilliseconds;
                        if (diff < 300) {
                          print("Debounced duplicate click (${diff}ms)");
                          return;
                        }
                      }
                      
                      _lastClickedCfi = cfi;
                      _lastClickTime = now;
                      
                      // Check if this CFI has notes
                      if (annotationManager.hasNotes(cfi)) {
                        _showNotesListDialog(cfi);
                      } else {
                        print("No notes found for this annotation");
                      }
                    },
                    onTextSelected: (epubTextSelection) {
                      setState(() {
                        textSelectionCfi = epubTextSelection.selectionCfi;
                        selectedText = epubTextSelection.selectedText;
                      });
                      print('Selected: $textSelectionCfi');
                    },
                    onLocationLoaded: () {
                      print('on location loaded');
                    },
                    onSelection:
                        (selectedText, cfiRange, selectionRect, viewRect) {
                      print("On selection changes");
                    },
                    onDeselection: () {
                      print("on deselection");
                    },
                    onSelectionChanging: () {
                      print("on selection changing");
                    },
                  ),
                  Visibility(
                    visible: isLoading,
                    child: const Center(child: CircularProgressIndicator()),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
