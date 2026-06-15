# 短信接码网站

轻量 Node 版本，前端是 iOS 玻璃拟态卡密兑换页，后端直接代理 sms.oapi.vip 的前端接口，客户可以直接使用从原网站购买的卡密。

## 本地启动

```bash
npm start
```

访问 `http://localhost:3000`。

## Docker

```bash
docker build -t sms-glass-relay .
docker run -d --name sms-glass-relay -p 3000:3000 sms-glass-relay
```

## 页面流程

1. 用户输入卡密并点击兑换。
2. 服务端调用 `open_get_phone` 获取手机号。
3. 兑换成功后跳转到 `/detail.html?session=...`。
4. 详情页每 3 秒调用服务端 `/api/sms` 查询验证码。
5. 未收到时保持等待，收到后停止轮询并显示短信全文与验证码。
