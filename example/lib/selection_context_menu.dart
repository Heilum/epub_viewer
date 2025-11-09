import 'package:flutter/material.dart';

/// Custom context menu for text selection in EPUB viewer
class SelectionContextMenu {
  OverlayEntry? _overlayEntry;
  final BuildContext context;

  SelectionContextMenu(this.context);

  /// Show the context menu at the specified position
  void show({
    required Rect selectionRect,
    required bool hasHighlight,
    required VoidCallback onHighlight,
    required VoidCallback onRemoveHighlight,
    required VoidCallback onAddNote,
    required VoidCallback onCopy,
    required VoidCallback onSearch,
    required VoidCallback onListen,
    required VoidCallback onReport,
  }) {
    // Remove existing overlay if any
    hide();

    _overlayEntry = OverlayEntry(
      builder: (context) => SelectionContextMenuWidget(
        selectionRect: selectionRect,
        hasHighlight: hasHighlight,
        onHighlight: () {
          hide();
          onHighlight();
        },
        onRemoveHighlight: () {
          hide();
          onRemoveHighlight();
        },
        onAddNote: () {
          hide();
          onAddNote();
        },
        onCopy: () {
          hide();
          onCopy();
        },
        onSearch: () {
          hide();
          onSearch();
        },
        onListen: () {
          hide();
          onListen();
        },
        onReport: () {
          hide();
          onReport();
        },
        onDismiss: hide,
      ),
    );

    Overlay.of(context).insert(_overlayEntry!);
    debugPrint('自定义的contextMenu显示了');
  }

  /// Hide and remove the context menu
  void hide() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  /// Check if menu is currently showing
  bool get isShowing => _overlayEntry != null;
}

/// The actual widget for the context menu
class SelectionContextMenuWidget extends StatelessWidget {
  final Rect selectionRect;
  final bool hasHighlight;
  final VoidCallback onHighlight;
  final VoidCallback onRemoveHighlight;
  final VoidCallback onAddNote;
  final VoidCallback onCopy;
  final VoidCallback onSearch;
  final VoidCallback onListen;
  final VoidCallback onReport;
  final VoidCallback onDismiss;

  const SelectionContextMenuWidget({
    super.key,
    required this.selectionRect,
    required this.hasHighlight,
    required this.onHighlight,
    required this.onRemoveHighlight,
    required this.onAddNote,
    required this.onCopy,
    required this.onSearch,
    required this.onListen,
    required this.onReport,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    debugPrint('SelectionContextMenuWidget building...');
    return Material(
      type: MaterialType.transparency,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Invisible barrier to detect taps outside the menu
          GestureDetector(
            onTap: () {
              debugPrint('Barrier tapped, dismissing menu');
              onDismiss();
            },
            behavior: HitTestBehavior.opaque,
            child: Container(
              color: Colors.black.withOpacity(0.01), // Very subtle overlay
            ),
          ),
          // The actual menu
          _buildMenu(context),
        ],
      ),
    );
  }

  Widget _buildMenu(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;
    final padding = MediaQuery.of(context).padding;

    // Account for system UI (status bar, navigation bar, etc.)
    final safeTop = padding.top;
    final safeBottom = screenSize.height - padding.bottom;
    final safeLeft = padding.left + 8.0; // Add some padding
    final safeRight = screenSize.width - padding.right - 8.0;

    debugPrint('Selection rect: $selectionRect');
    debugPrint(
        'Screen size: $screenSize, Safe area: top=$safeTop, bottom=$safeBottom');

    // Estimated menu dimensions (horizontal layout: 6 items side by side)
    const estimatedMenuHeight = 70.0; // Icon + text + padding
    const estimatedMenuWidth = 480.0; // ~80px per item * 6 items

    // Calculate initial position (below and centered on selection)
    double menuTop = selectionRect.bottom + 8;
    double menuLeft = selectionRect.left +
        (selectionRect.width / 2) -
        (estimatedMenuWidth / 2);

    // Vertical positioning: check if menu fits below selection
    if (menuTop + estimatedMenuHeight > safeBottom) {
      // Not enough space below, try above
      menuTop = selectionRect.top - estimatedMenuHeight - 8;

      // If still doesn't fit above, position at bottom of safe area
      if (menuTop < safeTop) {
        menuTop = safeBottom - estimatedMenuHeight - 8;
      }
    }

    // Ensure menu doesn't go above safe area
    if (menuTop < safeTop) {
      menuTop = safeTop + 8;
    }

    // Horizontal positioning: ensure menu stays within safe bounds
    if (menuLeft < safeLeft) {
      // Too far left, align to left edge
      menuLeft = safeLeft;
    } else if (menuLeft + estimatedMenuWidth > safeRight) {
      // Too far right, align to right edge
      menuLeft = safeRight - estimatedMenuWidth;
    }

    // Final check: if menu is still too wide, ensure at least it starts from safe area
    if (menuLeft < safeLeft) {
      menuLeft = safeLeft;
    }

    debugPrint('Final menu position - top: $menuTop, left: $menuLeft');

    return Positioned(
      top: menuTop,
      left: menuLeft,
      child: Material(
        color: Colors.transparent,
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFF2C2C2E), // Dark background like iOS/Figma
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.3),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          child: IntrinsicHeight(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Copy button
                _MenuItemButton(
                  icon: Icons.copy,
                  label: '复制',
                  onTap: onCopy,
                  isFirst: true,
                ),
                const _MenuDivider(),

                // Note button
                _MenuItemButton(
                  icon: Icons.edit_note,
                  label: '笔记',
                  onTap: onAddNote,
                ),
                const _MenuDivider(),

                // Highlight/Remove Highlight button
                _MenuItemButton(
                  icon: hasHighlight
                      ? Icons.highlight_remove
                      : Icons.format_underlined,
                  label: hasHighlight ? '删除划线' : '划线',
                  onTap: hasHighlight ? onRemoveHighlight : onHighlight,
                ),
                const _MenuDivider(),

                // Search button
                _MenuItemButton(
                  icon: Icons.search,
                  label: '查询',
                  onTap: onSearch,
                ),
                const _MenuDivider(),

                // Listen button
                _MenuItemButton(
                  icon: Icons.hearing,
                  label: '听当前',
                  onTap: onListen,
                ),
                const _MenuDivider(),

                // Report button
                _MenuItemButton(
                  icon: Icons.flag_outlined,
                  label: '纠错',
                  onTap: onReport,
                  isLast: true,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Individual menu item button
class _MenuItemButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool isFirst;
  final bool isLast;

  const _MenuItemButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.isFirst = false,
    this.isLast = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.horizontal(
          left: isFirst ? const Radius.circular(12) : Radius.zero,
          right: isLast ? const Radius.circular(12) : Radius.zero,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 10,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 24,
                color: Colors.white,
              ),
              const SizedBox(height: 4),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  color: Colors.white,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Divider between menu items (vertical)
class _MenuDivider extends StatelessWidget {
  const _MenuDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      margin: const EdgeInsets.symmetric(vertical: 8),
      color: Colors.white.withOpacity(0.2),
    );
  }
}
