# 客户端对接文档

本文说明 Electron 课表客户端如何对接本项目线上服务。协议兼容原 ElectronClassSchedule 远端配置约定；线上地址已从本地开发环境切到生产域名。

## 1. 服务概览

| 项 | 值 |
|----|----|
| 管理端 / Web | `https://cs.zyg2024.top` |
| 客户端配置地址 | `https://cs.zyg2024.top/config.json` |
| 健康检查 | `https://cs.zyg2024.top/api/health` |
| 鉴权 | `/config.json` **不需要**登录；网页编辑与写接口走钉钉会话 |

编辑器里保存的是草稿；只有点击「发布」后，客户端拉取的 `/config.json` 才会更新。若当前自然周有已发布的临时调课，服务端会把本周有效结果合并进该接口，客户端无需单独处理调课接口。

## 2. 客户端如何配置

把客户端里原来的本地配置地址：

```text
http://localhost:3000/config.json
```

改成生产地址（只替换主机，路径保持不变）：

```text
https://cs.zyg2024.top/config.json
```

常见落点：

- Electron 源码中的 `REMOTE_CONFIG_URL`（例如 `resources/app/js/index.js`）
- 或构建环境变量 `NEXT_PUBLIC_CONFIG_URL`（若你的客户端用该变量注入）

改完后按原项目流程重新打包。当前客户端一般只在**启动时**请求一次配置；发布课表后需要**重启客户端**才会看到新内容。

## 3. 接口约定

### 3.1 `GET /config.json`

- **Method**：`GET`（亦支持 `OPTIONS` 预检）
- **Protocol**：HTTPS
- **Content-Type**：`application/json; charset=utf-8`
- **Body**：配置对象本身，**没有** `{ data: ... }` 之类包装
- **CORS**：
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type`
- **缓存**：`Cache-Control: no-cache`
- **失败**：服务不可用时返回 `503`，body 形如 `{ "error": "配置暂时不可用" }`

请求示例：

```http
GET /config.json HTTP/1.1
Host: cs.zyg2024.top
```

成功时直接得到根级 JSON 对象（字段见第 4 节）。

### 3.2 `GET /api/health`（可选）

用于探活，不参与课表渲染。

```json
{ "status": "ok", "database": "ok", "time": "2026-08-30T03:24:06.358Z" }
```

数据库异常时为 `503`。

## 4. 配置 JSON 结构

根对象字段与原 Electron 协议一致：

| 字段 | 类型 | 说明 |
|------|------|------|
| `countdown_target` | `string` | 倒计时目标日。正式值使用 `YYYY-MM-DD`；填 `"hidden"` 表示隐藏倒计时。客户端宜同时兼容旧写法 `YYYY-M-D`。 |
| `week_display` | `boolean` | 是否显示周次相关 UI。 |
| `subject_name` | `object` | 课程代码 → 展示名。`daily_class` 里出现的每个代码都必须能在此找到。 |
| `timetable` | `object` | 日程模板（如 `workday` / `weekend`）。键为 `HH:MM-HH:MM`，值为课程索引（从 `0` 起的整数）或事件文案（字符串）。 |
| `divider` | `object` | 各模板的分隔线位置，值为课程索引数组；键名须与 `timetable` 一致。 |
| `daily_class` | `array` | 固定 **7** 项：索引 `0`=周日 … `6`=周六。 |
| `css_style` | `object` | CSS 变量覆盖；空对象 `{}` 表示使用客户端默认样式。 |

### 4.1 `subject_name`

```json
"subject_name": {
  "语": "语文",
  "自": "自习",
  "自@语": "语文周测",
  "TBD": "待安排"
}
```

- 简单代码：如 `语`、`数`
- 复合代码：`左侧@右侧`，如 `自@语`
- 占位课：`TBD`（历史 `__UNASSIGNED__` 已在服务端规范化为 `TBD`）

### 4.2 `timetable`

```json
"timetable": {
  "workday": {
    "07:40-08:19": 0,
    "08:20-08:29": "课间",
    "08:30-09:09": 1
  },
  "weekend": {
    "07:30-08:29": 0,
    "08:30-08:39": "课间"
  }
}
```

- 时间段须按时间顺序排列、互不重叠
- 数值类 value 为 `classList` 的下标（从 `0` 连续递增）
- 字符串 value 为非课程事件（课间、午休等）

### 4.3 `divider`

```json
"divider": {
  "workday": [4, 8],
  "weekend": [3]
}
```

索引对应 `timetable` 里的课程索引，用于课表列表中的视觉分隔。

### 4.4 `daily_class`

```json
{
  "Chinese": "一",
  "English": "MON",
  "timetable": "workday",
  "classList": ["物", "英", "数", ["语", "语", "语", "语"], "自@语"]
}
```

| 字段 | 说明 |
|------|------|
| `Chinese` / `English` | 星期展示文案 |
| `timetable` | 引用根级 `timetable` 的某个模板名 |
| `classList` | 与模板中课程索引一一对应 |

`classList` 每一项可以是：

1. **字符串**：固定课程，每周相同  
2. **字符串数组（长度 ≥ 4）**：四周轮换；客户端按当前周次取下标 `0..3`（超出则用最后一项）

服务端若已合并「本周临时调课」，返回结果里对应格子可能已被展开为**单个字符串**；客户端应对两种形态都做兼容。

### 4.5 `css_style`

键必须是合法 CSS 自定义属性（以 `--` 开头）。编辑器常用项包括：

| 变量 | 含义（示例） |
|------|----------------|
| `--center-font-size` | 主内容字号（如 `50px`） |
| `--sub-font-size` | 副标题字号 |
| `--corner-font-size` | 角落字号 |
| `--countdown-font-size` | 倒计时字号 |
| `--global-border-radius` | 全局圆角 |
| `--global-bg-opacity` | 背景透明度 |
| `--container-bg-padding` | 容器内边距 |
| `--countdown-bg-padding` | 倒计时内边距 |
| `--container-space` / `--top-space` / `--main-horizontal-space` | 间距 |
| `--divider-width` / `--divider-margin` | 分隔线 |
| `--triangle-size` | 提示三角尺寸 |

未在客户端 CSS 中声明的变量会被忽略；空对象表示完全使用内置默认样式。

## 5. 完整示例（结构示意）

```json
{
  "countdown_target": "2024-06-07",
  "week_display": true,
  "subject_name": {
    "语": "语文",
    "数": "数学",
    "英": "英语",
    "自": "自习",
    "自@语": "语文周测"
  },
  "timetable": {
    "workday": {
      "07:40-08:19": 0,
      "08:20-08:29": "课间",
      "08:30-09:09": 1
    },
    "weekend": {
      "07:30-08:29": 0
    }
  },
  "divider": {
    "workday": [4, 8],
    "weekend": [3]
  },
  "daily_class": [
    {
      "Chinese": "日",
      "English": "SUN",
      "timetable": "weekend",
      "classList": [["物", "化", "英", "化"], "自"]
    },
    {
      "Chinese": "一",
      "English": "MON",
      "timetable": "workday",
      "classList": ["语", "数", "英"]
    }
  ],
  "css_style": {
    "--center-font-size": "50px",
    "--corner-font-size": "14px",
    "--global-border-radius": "16px"
  }
}
```

线上真实数据可直接打开：

```text
https://cs.zyg2024.top/config.json
```

## 6. 客户端实现建议

1. **启动时**请求 `https://cs.zyg2024.top/config.json`，`cache: "no-store"` 或等价禁用缓存。  
2. 校验根对象必填字段；`daily_class.length === 7`。  
3. 用当天对应的 `daily_class[day]`，再按其 `timetable` 名称取时间轴。  
4. 解析 `classList`：字符串直接查 `subject_name`；数组按周次取项后再查。  
5. 将 `css_style` 写入根节点或容器的 CSS 变量。  
6. `countdown_target === "hidden"` 时隐藏倒计时；否则按日期计算。  
7. HTTP 非 2xx 或 JSON 解析失败时，保留上次缓存或展示友好错误，避免白屏。  
8. 发布后需重启（或自行增加定时刷新）才能看到新配置。

## 7. 与 Web 管理端的关系

| 能力 | 客户端 | Web（钉钉） |
|------|--------|-------------|
| 读已发布课表 | `GET /config.json` | 首页 / 登录后接口 |
| 编辑草稿、调课、发布 | 不涉及 | `/editor` 等 |
| 权限与职位策略 | 不涉及 | `/admin/access` |

客户端只消费已发布配置；课表内容与样式一律以发布后的 `/config.json` 为准。

## 8. 验收清单

- [ ] 客户端配置地址为 `https://cs.zyg2024.top/config.json`
- [ ] 启动能拉到 JSON，课程名、时间轴、分隔线正常
- [ ] 四周轮换课按周次切换正确
- [ ] `css_style` 为空时用默认样式；有值时变量生效
- [ ] Web 端发布后，重启客户端可见更新
- [ ] 本周有临时调课时，无需额外接口即可看到合并结果
- [ ] 断网 / `503` 时有降级或错误提示

---

参考：历史上本地开发对接地址为 `http://localhost:3000/config.json`；生产仅将主机改为 `cs.zyg2024.top`，路径与字段协议保持不变。
