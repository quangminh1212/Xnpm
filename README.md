# Xnpm

Xnpm là ứng dụng local-first để quét, xem, quản lý và hỗ trợ phát triển các package Node.js/npm đang có trên máy.

## Chức năng chính

- quản lý thư mục scan package theo từng vùng làm việc
- quét đệ quy các dự án có `package.json`
- xem nhanh package manager, scripts, dependency count, workspace count và trạng thái sẵn sàng phát triển
- chạy trực tiếp các thao tác phổ biến từ UI: `install`, `lint`, `test`, `build`, `open folder`
- ghi log thao tác ra `logs/xnpm-dev.log` để dễ debug local

## Tech stack

- Frontend: React 19 + Vite + TypeScript
- Backend: Fastify + TypeScript
- Tooling: ESLint, Vitest, Supertest, TSX, Concurrently

## Chạy local

### 1. Cài dependency

```bash
npm install
```

### 2. Chạy development mode

```bash
npm run dev
```

- Frontend: `http://127.0.0.1:4174`
- Backend API: `http://127.0.0.1:4173`

### 3. Build production

```bash
npm run build
```

### 4. Chạy production

```bash
npm run start
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run start
```

## Kiến trúc chính

### Backend

- `server/app.ts`: khởi tạo Fastify, route API, serve static client khi build production
- `server/catalog.ts`: quét root, đọc `package.json`, chuẩn hóa metadata package
- `server/store.ts`: lưu scan roots local vào `data/runtime/roots.json`
- `server/process-runner.ts`: chạy action theo package manager
- `server/logger.ts`: ghi log debug vào file `.log`

### Frontend

- `src/App.tsx`: dashboard chính, package list, detail panel, root manager, action console
- `src/styles.css`: design system, layout, màu, typography và responsive rules

## Quy ước quét package

- Bỏ qua: `.git`, `.next`, `.turbo`, `coverage`, `dist`, `build`, `node_modules`, `.cache`, `out`
- Package được xác định bởi file `package.json`
- Trạng thái package:
  - `Ready`: có đủ `lint`, `test`, `build`
  - `Needs polish`: có dấu hiệu phát triển nhưng thiếu workflow script
  - `Barebones`: package tối giản, cần hoàn thiện thêm

## Logging

- File log runtime: `logs/xnpm-dev.log`
- File này được ignore trong git để không làm bẩn lịch sử commit

## Tương thích hệ điều hành

- Đã thiết kế để chạy trên Windows, Linux và macOS với cùng codebase Node.js/React/Fastify
- Build, test, lint và scan package dùng Node API + npm scripts, tránh phụ thuộc trực tiếp vào Bash hoặc PowerShell
- Thao tác `open folder` tự chọn lệnh phù hợp theo nền tảng:
  - Windows: `explorer`
  - macOS: `open`
  - Linux: ưu tiên `xdg-open`, fallback sang `gio open`, `gnome-open`, `kde-open`
- Có thể override lệnh mở thư mục bằng biến môi trường `XNPM_OPEN_FOLDER_COMMAND` nếu máy dùng launcher khác
- Có thể override thư mục runtime bằng `XNPM_RUNTIME_DIR` và danh sách root gợi ý bằng `XNPM_SUGGESTED_ROOTS`

## Tiêu chuẩn chất lượng

- TypeScript strict mode
- Lint riêng cho frontend và backend trong cùng một project
- Test unit + API bằng Vitest/Supertest
- Build client và server tách biệt để dễ kiểm soát

## Định hướng mở rộng

- thêm batch actions cho nhiều package
- thêm dependency health/outdated analyzer
- thêm terminal log streaming theo thời gian thực
- thêm export inventory sang JSON/CSV
