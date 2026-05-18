# IQ-Code

IQ-Code 是一个基于 Claude Code 构建的项目，它并非简单的套壳，而是深度接入了 DeepSeek 的 Code 能力。

---

## 安装指南

Linux / macOS

```bash
# 安装 Bun
curl -fsSL https://bun.com/install | bash

# 克隆仓库
git clone https://github.com/iqisge-gif/IQ-code.git

# 安装依赖
bun install
```

Windows

```powershell
# 安装 Bun
powershell -c "irm bun.sh/install.ps1|iex"

# 克隆仓库
git clone https://github.com/iqisge-gif/IQ-code.git

# 安装依赖
bun install
```

---

运行

```bash
bun dev run
```

---

## Termux 专区

1. 安装 Termux 版 Bun

```bash
curl -fsSL "https://raw.githubusercontent.com/Happ1ness-dev/bun-termux/main/helper_scripts/bun-termux-manager" | bash -s install
```

> ⚠️ 安装完成后重启终端。

2. 安装项目

```bash
git clone https://github.com/iqisge-gif/IQ-code.git
cd IQ-code
bun install
```

3. 运行

```bash
bun run dev
```