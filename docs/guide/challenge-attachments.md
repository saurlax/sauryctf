# 题目附件

题目附件继续使用 `attachments` 字段保存，格式仍为 JSON 字符串数组，例如：

```json
[
  "https://example.com/files/web.zip",
  "/attachments/1234567890-challenge.zip"
]
```

## 管理端上传

- 创建题目、编辑题目弹窗都提供“上传本地附件”入口
- 上传成功后，系统会把返回的 `/attachments/**` 路径自动追加到当前 `attachments` JSON 数组
- 外部下载链接仍然可以手工补充或保留

## 本地附件目录

- 本地附件统一保存到后端运行目录下的 `./attachments`
- 对外访问路径为 `/attachments/**`

## 导入导出

- 外部链接会按原值保留
- 本地 `/attachments/**` 文件会在比赛导出时打包进 ZIP
- 导入比赛包时，内嵌的本地附件会恢复回 `./attachments`
