# 课表编排器

这是一个兼容 ElectronClassSchedule 远端配置协议的 Next.js 课程表编辑器。

## 本地开发

1. 复制 `.env.example` 为 `.env.local`，填写开发环境的 `DATABASE_URL`；本地测试可以保留 `DINGTALK_DEV_AUTH=true`。
2. 执行 `npm install`。
3. 执行 `npx prisma migrate dev`。
4. 执行 `npm run db:seed`，首次初始化现有课表或空白课表。
5. 执行 `npm run dev`，打开 `http://localhost:3000`。

开发环境通过显式 `DINGTALK_DEV_AUTH=true` 使用本地测试用户；生产环境必须通过钉钉工作台免登。普通编辑保存后会更新课表草稿，点击“发布”后才会更新客户端使用的课表。调课模式里的 `√` 只保存本周调课草稿，仍需点击“发布草稿”才会生效；调课默认只在当前自然周有效。

## 钉钉接入

这是企业内部应用的 H5 网页应用接入。需要在钉钉开发者后台配置应用首页地址、重定向 URL/端内免登地址和服务端出口 IP，并为应用开通成员信息读权限。服务端使用 `DINGTALK_CORP_ID`、`DINGTALK_CLIENT_ID` 和 `DINGTALK_CLIENT_SECRET` 获取应用 Access Token，再通过免登码读取当前用户的 `userid/unionid` 和职位信息。

首页展示已发布课表。职位为“班主任”或“主管理员”的用户默认可以编辑；钉钉用户详情中的 `admin`、`boss` 或 `senior` 任一字段为 `true` 的用户拥有主管理员权限，可以在 `/admin/access` 设置可编辑职位。生产环境不要设置 `DINGTALK_DEV_AUTH`，也不要把钉钉 Secret 提交到仓库。

## 兼容接口

Electron 客户端读取课表的地址为 `GET /config.json`。成功响应是配置对象本身，不带 `data` 包装，并返回 Electron 客户端需要的 CORS 和 JSON 响应头。

客户端发布后，把外部 Electron 源码 `resources/app/js/index.js` 中的 `REMOTE_CONFIG_URL` 改为生产地址，例如 `https://schedule.example.com/config.json`，然后按原项目流程重新打包。当前 Electron 客户端只在启动阶段请求配置，发布后需要重启客户端。

## 生产部署

生产服务器建议使用独立 MySQL 数据库，例如 `class_schedule`，不要把本项目接到已经存在其他 Prisma migration 历史的数据库上。通过环境变量设置生产 `DATABASE_URL`，不要提交真实凭据。

```bash
npm ci
npx prisma migrate deploy
npm run build
EDITOR_ENABLED=true npm run start
```

生产环境建议使用 HTTPS，并通过 Nginx 暴露应用地址。`/config.json` 仍然不要求登录，以兼容 Electron 客户端；网页首页、编辑器和所有写接口都要求钉钉会话。首次部署后运行 `npx prisma migrate deploy`，再运行 `npm run build`。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
