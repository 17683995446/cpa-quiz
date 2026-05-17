# CPA智刷 - 注册会计师考试刷题平台

## 一键启动

### Windows 用户
双击运行 `start.bat` 文件，即可自动启动服务器并打开浏览器。

### Mac/Linux 用户
1. 打开终端
2. 进入项目目录：`cd /path/to/cpa-quiz`
3. 运行：`bash start.sh`

## 手动启动

如果一键启动失败，可以手动启动：

```bash
# 进入项目目录
cd cpa-quiz

# 启动服务器
python -m http.server 8080

# 在浏览器中打开
http://localhost:8080
```

## 系统要求

- Python 3.x（通常已预装）
- 现代浏览器（Chrome/Firefox/Edge/Safari）

## 功能特点

- 5100+ 精选真题
- 6大科目全覆盖
- AI增强解析
- 错题本、收藏夹、笔记
- 模拟考试、每日一练
- 学习统计、排行榜

## 数据说明

- 题目数据位于 `data/` 目录
- 学习记录保存在浏览器本地存储

## 技术支持

如有问题，请检查：
1. Python是否安装：`python --version`
2. 8080端口是否被占用
3. 防火墙是否阻止本地访问
