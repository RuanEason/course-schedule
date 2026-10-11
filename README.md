# 课表编排器

这是一个兼容 ElectronClassSchedule 远端配置协议的 Next.js 课程表编辑器。

## 本地开发

1. 复制 `.env.example` 为 `.env.local`，填写开发环境的 `DATABASE_URL`；本地测试可以保留 `DINGTALK_DEV_AUTH=true`。
2. 执行 `npm install`。
3. 执行 `npx prisma migrate dev`。
4. 执行 `npm run db:seed`，首次初始化现有课表或空白课表。
5. 执行 `npm run dev`，打开 `http://localhost:3000`。

开发环境通过显式 `DINGTALK_DEV_AUTH=true` 使用本地测试用户；生产环境必须通过钉钉工作台免登。普通编辑保存后会更新课表草稿，点击“发布”后才会更新客户端使用的课表。调课模式里的 `√` 只保存本周调课草稿，仍需点击“发布草稿”才会生效；调课默认只在当前自然周有效。

## 调课与补课

调课模式处理的是「这一周临时变化」，刻意与长期排课分开：

- **补课（日期覆盖）**：天头上点“补课”，选择“这天上哪天的课”，该天会立刻换成目标星期的模板与全部课程，不需要手动搬课。例如周日补周一的课：周日原本是 `weekend` 模板，选“星期一”后会自动排满 `workday` 的 11 节课。源星期课程不足时，缺少的槽位会如实标为“待安排”，不会静默留空。
- 日期覆盖按自然日生效，只在保存它的那一周有效，并按 `Asia/Shanghai` 计算。
- 日期覆盖以 `dayOverrides` 字段存放在调课 payload 中，**不进入 `ScheduleConfig`**，因此 `/config.json` 的配置契约与 Electron 客户端不受影响。
- `GET /config.json` 会按**服务器当天日期**解析补课，所以补课当天需要重启 Electron 客户端（客户端只在启动时拉取配置）。

「日程模板」面板是一个工具条：每个模板是一个 chip，复制与删除图标在各自 chip 内部，右端 `+` 展开内联输入框用于新增模板，选中后在下方轻量行内重命名。

四周轮换默认关闭：只有四个周的课程确实不同时，单元格才会显示 `4W` 角标。普通的临时调课以 `changedCells` 表达，不会把课程升级成四周数组，也不会因此点亮 `4W`；只有显式开启“四周轮换”才会写入四周数组。

## 钉钉接入

这是企业内部应用的 H5 网页应用接入。需要在钉钉开发者后台配置应用首页地址、重定向 URL/端内免登地址和服务端出口 IP，并为应用开通成员信息读权限。服务端使用 `DINGTALK_CORP_ID`、`DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET` 获取应用 Access Token，再通过免登码读取当前用户的 `userid/unionid` 和职位信息。

首页展示已发布课表。职位为“班主任”或“主管理员”的用户默认可以编辑；钉钉用户详情中的 `admin`、`boss` 或 `senior` 任一字段为 `true` 的用户拥有主管理员权限，可以在 `/admin/access` 设置可编辑职位。生产环境不要设置 `DINGTALK_DEV_AUTH`，也不要把钉钉 Secret 提交到仓库。

## 多班级

一个部署可以服务多个班级，班级之间**完全隔离**：课表、草稿、临时调课、历史版本、在线编辑状态各自独立，编辑权限也按班级分配。不需要为每个班级跑一个进程或改代码。

班级用「标识」（slug）表示，形如 `class2`。标识同时是访问路径和数据分区键：

| 班级 | 网页入口 | 客户端配置地址 |
|------|----------|----------------|
| 1 班（`default`） | `/` | `/config.json` |
| 2 班（`class2`） | `/class2`、`/class2/editor` | `/class2/config.json` |
| 3 班（`class3`） | `/class3`、`/class3/editor` | `/class3/config.json` |

根地址（`/` 和 `/config.json`）属于哪个班由 `CLASS_CONFIG_SLUG` 决定，默认为 `default`。**因此已部署的 Electron 客户端无需改动**——它请求的 `/config.json` 行为与多班级之前完全一致。

### 新增一个班级

1. 用主管理员账号登录，打开「班级管理」（`/admin/classes`）。
2. 填入标识（如 `class4`）和显示名称（如「4 班」），点击创建。**标识创建后不可修改**，它同时是数据分区键和访问地址。
3. 在该班级的成员列表里加入需要编辑它的老师（按钉钉用户 ID，对方需至少登录过一次）。
4. 把新班级的客户端地址 `/class4/config.json` 写进对应教室的客户端配置并重新打包。

不需要改代码、不需要重新部署、不需要重启服务。

### 权限模型

| 层级 | 决定什么 | 在哪里配置 |
|------|----------|-----------|
| 职位策略 | 哪些**职位**（如“班主任”）有编辑课表的资格 | `/admin/access`（全局，主管理员） |
| 班级成员 | 有资格的人具体能编辑**哪些班级** | `/admin/classes`（按班级） |

两者是「与」的关系：既要有资格，也要被分配到该班级。钉钉的 `admin`/`boss`/`senior` 用户是主管理员，可编辑所有班级。普通老师只有被分配到的那几个班级；跨班访问（如 1 班老师打开 `/class2/editor`）会直接返回 404，不会泄露其他班级的内容。

### 本地开发多个班级

```bash
SEED_CLASSES="class2:2 班,class3:3 班" npm run db:seed
```

开发用的免登测试用户在数据库里没有成员记录，因此需要显式指定它能编辑的班级：

```bash
DINGTALK_DEV_USER_CLASSES="default,class2,class3"
```

不设置时默认为 `default`，与单班级时的行为一致。

### 班级路由是怎么实现的

请求进入时由 `proxy.ts` 解析 `/classN` 前缀，把班级写进内部请求头 `x-class-schedule-class`，页面和接口再从请求头读取班级。这样做有两个好处：班级不落 cookie（一个浏览器同时开两个班会互相污染），Electron 客户端没有 cookie 也能正确定位班级。

`x-class-schedule-class` 是服务端内部约定：Nginx 必须清空它（`proxy_set_header x-class-schedule-class "";`），应用侧也会强制覆盖。即使被伪造，接口仍会按数据库里的成员关系重新校验，最多只能访问本来就已授权的班级。

如果希望按端口区分客户端（如 2 班固定用 `:3002`），在 Nginx 里把端口映射到对应路径即可，两种地址返回的 JSON 完全相同。配置样例见 [CLIENT_INTEGRATION.md](./CLIENT_INTEGRATION.md) 第 9 节。

## 兼容接口

Electron 客户端读取课表的地址为 `GET /config.json`（多班级下为 `GET /classN/config.json`）。成功响应是配置对象本身，不带 `data` 包装，并返回 Electron 客户端需要的 CORS 和 JSON 响应头。

客户端发布后，把外部 Electron 源码 `resources/app/js/index.js` 中的 `REMOTE_CONFIG_URL` 改为生产地址，例如 `https://schedule.example.com/config.json`，然后按原项目流程重新打包。当前 Electron 客户端只在启动阶段请求配置，发布后需要重启客户端。

## 生产部署

生产服务器建议使用独立 MySQL 数据库，例如 `class_schedule`，不要把本项目接到已经存在其他 Prisma migration 历史的数据库上。通过环境变量设置生产 `DATABASE_URL`，不要提交真实凭据。

```bash
npm ci
npx prisma migrate deploy
npm run build
EDITOR_ENABLED=true npm run start
```

生产环境建议使用 HTTPS，并通过 Nginx 暴露应用地址。`/config.json`（以及 `/classN/config.json`）仍然不要求登录，以兼容 Electron 客户端；网页首页、编辑器和所有写接口都要求钉钉会话。首次部署后运行 `npx prisma migrate deploy`，再运行 `npm run build`。

所有班级共用**同一个** Next.js 实例；班级由路径区分。Nginx 里务必清空内部班级请求头：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header x-class-schedule-class "";
}
```

按端口区分客户端的完整配置样例见 [CLIENT_INTEGRATION.md](./CLIENT_INTEGRATION.md) 第 9 节。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
