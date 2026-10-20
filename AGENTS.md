# NavisworksMCP

AI 驅動的 Navisworks 自動化控制系統，透過 Model Context Protocol (MCP) 讓 AI 平台操控 Autodesk Navisworks。

## 架構

```
AI 平台 ←→ MCP Server (Node.js, stdio) ←→ WebSocket (port 2233) ←→ Navisworks Add-in (C#)
```

## 開發規則

- WebSocket 端口固定為 **2233**
- C# 專案目標 .NET Framework 4.8，Navisworks 2020
- Navisworks API 引用的 Copy Local 必須設為 False
- 命令在 Navisworks 主執行緒中透過 Timer polling 執行
- MCP Server 使用 stdio transport
- 每次重大修改後需 git commit + push

## 專案結構

```
MCP/                    # C# Navisworks Add-in
├── Application.cs      # Plugin 入口 (AddInPlugin + EventWatcher)
├── Core/
│   ├── CommandExecutor.cs    # 命令執行器（所有 MCP 命令實作）
│   ├── QuantificationExecutor.cs  # Quantification/Takeoff 命令
│   ├── SocketService.cs      # WebSocket 服務 (port 2233)
│   └── Logger.cs
├── Models/
└── NavisworksMCP.csproj

MCP-Server/             # Node.js MCP Server
├── src/
│   ├── index.ts        # MCP Server 入口
│   ├── socket.ts       # WebSocket 客戶端
│   └── tools/navis-tools.ts  # 工具定義
├── package.json
└── tsconfig.json
```

## 可用 MCP 命令

### 文件與模型
- `get_document_info` / `get_model_info` / `get_model_tree`

### 選擇與搜尋
- `get_current_selection` / `select_items_by_search` / `clear_selection`
- `search_items` / `get_all_categories`

### 屬性
- `get_item_properties` / `get_item_geometry_info` / `batch_get_properties`

### 視點
- `get_viewpoints` / `set_active_viewpoint` / `save_viewpoint`

### 子樹操作
- `scan_subtree` — 掃描 NWC 子樹，回傳 Category/Family/Type 統計（含祖先屬性查找）
- `select_subtree` — 選取子樹所有幾何到 CurrentSelection

### 顯示控制
- `zoom_to_selection` / `set_item_override_color` / `clear_override_colors`
- `hide_items` / `unhide_all` / `hide_all_except`
- `isolate_selection` — 隱藏所有，只保留當前選擇
- `isolate_by_property` — 按屬性值搜尋並隔離顯示

### Quantification
- `quantification_get_items` / `quantification_get_item_groups`
- `quantification_import_bq` / `quantification_exec_sql`

### 其他
- `get_selection_sets` / `select_items_by_set`
- `get_clash_tests` / `get_clash_results`
- `get_model_statistics`

## Navisworks API 注意事項（本機環境：Manage 2020）

- 無 `Autodesk.Navisworks.Gui.dll`
- `Count` 是 LINQ 方法不是屬性，用 `Count()`
- 無 `ResetPermanentColor` → 用 `ResetPermanentMaterials()`
- `SavedItemCollection` 無 public 無參建構子
- `SearchCondition` 只有 `EqualValue()` 可靠
- Post-build 複製到 Program Files 需管理員權限

## 實際踩過的坑（2026-10-20 驗證於 Navisworks Manage 2020）

### 1. Newtonsoft.Json 版本衝突（2020 專屬）
NW2020 主目錄內建 Newtonsoft.Json **6.0.0.0**（2025 版較新故無此問題），會先載入進程；
外掛綁 13.0.0.0 時綁定失敗，症狀是 **WebSocket 連得上但命令永遠不回應**，
日誌出現 `The located assembly's manifest definition does not match the assembly reference`。
解法：`Core/AssemblyResolver.cs` 掛 `AppDomain.AssemblyResolve`，失敗時從外掛資料夾載入正確版本。
註冊時機必須早於任何 Newtonsoft 型別被使用（已放在 `MCPEventWatcher.OnLoaded`）。

### 2. 兩端 JSON 命名不一致（與 NW 版本無關，原始碼本身的錯）
- 回應：C# 預設輸出 PascalCase，socket.ts 以 `response.requestId` 配對 → 配不到 handler，**每個命令逾時 30 秒**
- 請求：socket.ts 曾用 `toPascalCase()` 轉換參數鍵，但 C# 以 `parameters["groupBy"]` 這類
  camelCase 鍵查 `Dictionary`（大小寫敏感）→ **所有參數被靜默忽略、套用預設值**

兩端一律使用 **camelCase**。改回應時用 `[JsonProperty]` 逐一標註，
不要設全域 CamelCase 解析器 —— 後者會連 `Data` 內的字典鍵一併轉換，
破壞 Navisworks 屬性名稱（如 `Source File`、`Element`）。

### 3. 中文介面的屬性分類名是中文
中文版 Navisworks 實測回傳：`元素`、`元素 ID`、`項目`、`專案`、`轉換`、`外部參考`、`TimeLiner`。
`search_items` / `batch_get_properties` 的 `category` 要用中文，文件裡的 `Element`、`Item` 搜不到東西。

### 4. 統計類工具有寫死的掃描上限
`SafeDescendants(10000)`（`get_model_statistics`）、`SafeDescendants(5000)`
（`get_override_status`、`get_hidden_items`）都沒開放參數調整，
回傳的 `totalItems` / `totalScanned` 是截斷值，聯合模型下不具參考意義。

### 5. 部署腳本編碼
`.ps1` 含中文時必須存成 **UTF-8 with BOM**。PowerShell 5.1 讀無 BOM 檔案會當成
ANSI（台灣為 cp950），中文被誤解後可能吃掉引號，報出與實際無關的
`陳述式區塊或類型定義中缺少 '}'`。

## B001 模型結構

```
L0: DE_MSI_001_ALL_B001_Federated Model (combined).nwd
 └─ L1: DE_MSI_001_ALL_B001_Federated Model.nwd (23 NWC/NWD)
     ├─ CUB_B001_A_ARCH.nwc → 4.1 Non-CR Architecture
     ├─ FAB_B001_A_ARCH.nwc → 4.2 CR Architecture
     ├─ CUB/FAB_B001_S_STRU.nwc → 3. Structure
     ├─ CUB/FAB_B001_M_DUCT.nwc → 5.1/5.2 HVAC
     ├─ CUB/FAB_B001_M_CHWT.nwc → 7.4 PCW
     ├─ CUB/FAB_B001_P_PLUM.nwc → 2.3 PHE Works
     ├─ CUB/FAB_B001_F_FPRT.nwc → 11.1/11.2 Fire Protection
     ├─ CUB/FAB_B001_E_ELEC.nwc → 10.1/10.2 Electrical
     ├─ CUB/FAB_B001_I_INST.nwc → 9.x ELV (sub-classify by Category)
     ├─ CUB/FAB_B001_M_EGEX.nwc → 6.1/6.2 Exhaust
     ├─ SIT_B001_C_CIVIL.nwc → 2.1 Civil Works
     ├─ ALL_B001_M_EQPM.nwd → 6.2 Exhaust Equipment
     ├─ ALL_B001_D_PRWT.nwd → 8 Waste Water
     ├─ ALL_B001_N_GASS.nwd → 12. Gas
     └─ ALL_D_INAP.nwd → 7.1-7.5 Utility (含 DWG 子檔: CDA/HPCDA/PV/ICA/NG)
```

- CUB = Non-Cleanroom, FAB = Cleanroom
- I_INST 按 Revit Category 子分類: Fire Alarm→9.2, Security→9.3, Communication→9.4, Data→9.6, Electrical Equipment→9.1, 其他→9.5 FMCS

## 當前進度

### 已完成
- 26/29 BQ 表單匹配，243,873 幾何元素
- Quantification 同步：29 groups, 3,673 items
- 交叉比對報告：`BOQ_vs_Model_Report.xlsx`
- `System Abbreviation` 確認為最佳系統分離欄位

### 進行中
- MEP 系統逐一隔離 + 存場景（`isolate_by_property` 命令已加，待測試）

### 待做
- 屬性品質稽核
- Auto-takeoff 匹配規則

## BOQ Excel
`C:\Users\Admin\Downloads\Appendix A - MSI-1-MH-BQ-G-00256_Rev_1_Bill of Quantity.xlsx`
Micron MSI1 7A Bumping, 29 BOQ sheets

## 部署
```bash
# Build
dotnet build MCP/NavisworksMCP.csproj -c Release

# Deploy (需管理員權限，NW 必須關閉)
powershell -Command "Start-Process robocopy -Verb RunAs -Wait -ArgumentList 'C:\Users\Admin\DESKTOP\NV_mcp\MCP\bin\Release \"C:\Program Files\Autodesk\Navisworks Manage 2020\Plugins\NavisworksMCP\" NavisworksMCP.dll NavisworksMCP.pdb /IS /IT'"

# MCP Server
cd MCP-Server && npm run build
```
