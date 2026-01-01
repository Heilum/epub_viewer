# EPUB 导航按钮功能

## 概述

此功能允许您在 EPUB 内容的末尾添加"上一篇"和"下一篇"导航按钮。按钮会直接嵌入到 EPUB 内容中，而不是作为浮动的工具栏。

## 按钮样式

- **可点击按钮**: 背景色 `#FF9945` (橙色)
- **不可点击按钮**: 背景色 `#FBC9A0` (浅橙色)

## 使用方法

### 1. 添加导航按钮

```dart
// 在 EPUB 内容末尾添加导航按钮
await epubController.addNavigationButtons(
  hasPrevious: true,  // 是否有上一篇
  hasNext: true,      // 是否有下一篇
);
```

### 2. 移除导航按钮

```dart
// 移除导航按钮
await epubController.removeNavigationButtons();
```

### 3. 处理按钮点击事件

在 `EpubViewer` 中设置回调函数：

```dart
EpubViewer(
  epubController: _epubController,
  epubSource: _epubSource,
  // ... 其他参数
  
  // 上一篇按钮点击回调
  onPreviousArticle: () {
    print('用户点击了上一篇');
    // 在这里处理跳转到上一篇文章的逻辑
    // 例如：加载上一篇文章的 EPUB 文件
  },
  
  // 下一篇按钮点击回调
  onNextArticle: () {
    print('用户点击了下一篇');
    // 在这里处理跳转到下一篇文章的逻辑
    // 例如：加载下一篇文章的 EPUB 文件
  },
)
```

## 完整示例

```dart
class EpubReaderPage extends StatefulWidget {
  @override
  _EpubReaderPageState createState() => _EpubReaderPageState();
}

class _EpubReaderPageState extends State<EpubReaderPage> {
  late EpubController _epubController;
  int currentArticleIndex = 0;
  List<String> articles = ['article1.epub', 'article2.epub', 'article3.epub'];

  @override
  void initState() {
    super.initState();
    _epubController = EpubController();
  }

  void _updateNavigationButtons() {
    // 根据当前文章位置更新按钮状态
    _epubController.addNavigationButtons(
      hasPrevious: currentArticleIndex > 0,
      hasNext: currentArticleIndex < articles.length - 1,
    );
  }

  void _goToPreviousArticle() {
    if (currentArticleIndex > 0) {
      setState(() {
        currentArticleIndex--;
      });
      // 加载上一篇文章
      _loadArticle(articles[currentArticleIndex]);
    }
  }

  void _goToNextArticle() {
    if (currentArticleIndex < articles.length - 1) {
      setState(() {
        currentArticleIndex++;
      });
      // 加载下一篇文章
      _loadArticle(articles[currentArticleIndex]);
    }
  }

  void _loadArticle(String articlePath) {
    // 加载文章的逻辑
    // ...
    
    // 加载完成后更新导航按钮
    _updateNavigationButtons();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: EpubViewer(
        epubController: _epubController,
        epubSource: EpubSource.fromAsset('assets/$currentArticle'),
        
        onEpubLoaded: () {
          // EPUB 加载完成后添加导航按钮
          _updateNavigationButtons();
        },
        
        onPreviousArticle: _goToPreviousArticle,
        onNextArticle: _goToNextArticle,
      ),
    );
  }
}
```

## 注意事项

1. **按钮位置**: 按钮会自动添加到每个 EPUB 内容视图的 `<body>` 标签末尾
2. **自动清理**: 调用 `addNavigationButtons` 时，会自动移除之前添加的按钮，避免重复
3. **滚动模式**: 此功能在滚动模式 (`EpubFlow.scrolled`) 下效果最佳
4. **多视图**: 如果 EPUB 有多个内容视图，每个视图都会添加按钮

## 技术细节

### JavaScript 实现

导航按钮通过以下 JavaScript 函数实现：

- `addNavigationButtons(hasPrevious, hasNext)` - 添加按钮
- `removeNavigationButtons()` - 移除按钮

这些函数会：
1. 遍历所有 EPUB 内容视图
2. 在每个视图的 `<body>` 末尾创建按钮容器
3. 根据参数设置按钮的可用状态和样式
4. 为可点击的按钮添加事件监听器

### 样式定制

如果需要自定义按钮样式，可以修改 `epubView.js` 中的 `addNavigationButtons` 函数。
