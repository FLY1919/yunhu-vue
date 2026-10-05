# 云湖接口覆盖情况

> 由 `node scripts/api-coverage.mjs` 生成 —— 把「社区文档收录的接口」和「本项目实际调用的接口」对齐。

- 文档收录：**234** 个
- 已使用：**94** 个（文档内 93）
- 还没用：**141** 个

## 一、已实现（文档内）

**bot**
- `/v1/bot/board` — src/plugins/api.ts
- `/v1/bot/bot-info` — src/plugins/api.ts
- `/v1/bot/console/my-bots` — src/plugins/api.ts
- `/v1/bot/create-bot` — src/plugins/api.ts
- `/v1/bot/edit-setting-json` — src/plugins/api.ts
- `/v1/bot/reset-bot-token` — src/plugins/api.ts
- `/v1/bot/web-edit-bot` — src/plugins/api.ts

**chat-background**
- `/v1/chat-background/edit` — src/plugins/api.ts
- `/v1/chat-background/list` — src/plugins/api.ts

**community**
- `/v1/community/ba/create` — src/plugins/api.ts
- `/v1/community/ba/edit` — src/plugins/api.ts
- `/v1/community/ba/following-ba-list` — src/plugins/api.ts
- `/v1/community/ba/group-list` — src/plugins/api.ts
- `/v1/community/ba/info` — src/plugins/api.ts
- `/v1/community/ba/list-by-create` — src/plugins/api.ts
- `/v1/community/ba/manage` — src/plugins/api.ts
- `/v1/community/posts/create` — src/plugins/api.ts
- `/v1/community/posts/post-detail` — src/plugins/api.ts
- `/v1/community/posts/post-list` — src/plugins/api.ts

**conversation**
- `/v1/conversation/dismiss-notification` — src/plugins/api.ts
- `/v1/conversation/list` — src/plugins/api.ts、src/plugins/http.ts

**disk**
- `/v1/disk/create-folder` — src/plugins/api.ts、webdav.ts
- `/v1/disk/file-list` — src/plugins/api.ts、webdav.ts
- `/v1/disk/file-size` — src/plugins/api.ts
- `/v1/disk/remove` — src/plugins/api.ts、webdav.ts
- `/v1/disk/upload-file` — webdav.ts

**expression**
- `/v1/expression/add` — src/plugins/api.ts
- `/v1/expression/create` — src/plugins/api.ts
- `/v1/expression/delete` — src/plugins/api.ts
- `/v1/expression/list` — src/plugins/api.ts
- `/v1/expression/topping` — src/plugins/api.ts

**friend**
- `/v1/friend/address-book-list` — src/plugins/api.ts、satori-ws.ts、satori.ts、webdav.ts
- `/v1/friend/agree-apply` — src/plugins/api.ts
- `/v1/friend/apply` — src/plugins/api.ts
- `/v1/friend/delete-friend` — src/plugins/api.ts
- `/v1/friend/delete-request` — src/plugins/api.ts
- `/v1/friend/ignore-apply` — src/plugins/api.ts
- `/v1/friend/no-notify` — src/plugins/api.ts
- `/v1/friend/request-list` — src/plugins/api.ts

**group-tag**
- `/v1/group-tag/create` — src/plugins/api.ts
- `/v1/group-tag/delete` — src/plugins/api.ts
- `/v1/group-tag/edit` — src/plugins/api.ts
- `/v1/group-tag/list` — src/plugins/api.ts
- `/v1/group-tag/members` — src/plugins/api.ts
- `/v1/group-tag/relate` — src/plugins/api.ts
- `/v1/group-tag/relate-cancel` — src/plugins/api.ts

**group**
- `/v1/group/bot-list` — src/plugins/api.ts
- `/v1/group/create-group` — src/plugins/api.ts
- `/v1/group/edit-group` — src/plugins/api.ts
- `/v1/group/edit-my-group-nickname` — src/plugins/api.ts
- `/v1/group/gag-member` — src/plugins/api.ts
- `/v1/group/info` — src/plugins/api.ts
- `/v1/group/instruction-list` — src/plugins/api.ts
- `/v1/group/invite` — src/plugins/api.ts
- `/v1/group/list-member` — src/plugins/api.ts
- `/v1/group/msg-type-limit` — src/plugins/api.ts
- `/v1/group/remove-member` — src/plugins/api.ts

**instruction**
- `/v1/instruction/create` — src/plugins/api.ts
- `/v1/instruction/edit` — src/plugins/api.ts
- `/v1/instruction/list` — src/plugins/api.ts
- `/v1/instruction/web-list` — src/plugins/api.ts

**misc**
- `/v1/misc/configure-distribution` — src/plugins/api.ts
- `/v1/misc/qiniu-token` — src/plugins/api.ts
- `/v1/misc/qiniu-token2` — src/plugins/api.ts、webdav.ts

**mount-setting**
- `/v1/mount-setting/create` — src/plugins/api.ts
- `/v1/mount-setting/delete` — src/plugins/api.ts

**msg**
- `/v1/msg/a2ui-form-report` — src/plugins/api.ts
- `/v1/msg/button-report` — src/plugins/api.ts
- `/v1/msg/edit-message` — src/plugins/api.ts、satori.ts
- `/v1/msg/list-message` — src/plugins/api.ts、satori-ws.ts、satori.ts
- `/v1/msg/list-message-edit-record` — src/plugins/api.ts
- `/v1/msg/msg-forward` — src/plugins/api.ts
- `/v1/msg/recall-msg` — src/plugins/api.ts、satori.ts
- `/v1/msg/recall-msg-batch` — src/plugins/api.ts
- `/v1/msg/send-message` — src/plugins/api.ts、satori.ts

**search**
- `/v1/search/chat-search` — src/plugins/api.ts

**sticker**
- `/v1/sticker/add-sticker` — src/plugins/api.ts
- `/v1/sticker/create-pack` — src/plugins/api.ts
- `/v1/sticker/delete-pack` — src/plugins/api.ts
- `/v1/sticker/detail` — src/plugins/api.ts
- `/v1/sticker/import-pack` — src/plugins/api.ts
- `/v1/sticker/list` — src/plugins/api.ts
- `/v1/sticker/remove-sticker` — src/plugins/api.ts
- `/v1/sticker/remove-sticker-pack` — src/plugins/api.ts
- `/v1/sticker/rename-pack` — src/plugins/api.ts
- `/v1/sticker/rename-sticker` — src/plugins/api.ts

**user**
- `/v1/user/edit-avatar` — src/plugins/api.ts
- `/v1/user/edit-nickname` — src/plugins/api.ts
- `/v1/user/email-login` — src/plugins/api.ts
- `/v1/user/get-user` — src/plugins/api.ts、satori.ts
- `/v1/user/get-user-data` — src/plugins/api.ts、satori.ts
- `/v1/user/info` — src/plugins/api.ts
- `/v1/user/save-user-data` — src/plugins/api.ts

## 二、项目里在用、但文档没收录的

这些是实测补出来的（或文档写错、我踩过坑纠正的），官方若有改动要优先回归：

- `/v1/mount-setting/list` — src/plugins/api.ts、webdav.ts

## 三、待实现清单

**beta**（1）  `beta/info`

**bot**（20）  `bot/banner`、`bot/bot-detail`、`bot/bot-group-list`、`bot/bot-link-reset`、`bot/edit-subscribed-link`、`bot/follower-list`、`bot/get-user-settings-json`、`bot/group-permission-edit`、`bot/group-permission-get`、`bot/join-group-list`、`bot/llm/clean-content`、`bot/llm/knowledge/create`、`bot/llm/knowledge/list`、`bot/llm/llm-setting-list`、`bot/llm/llm-setting-ref-info`、`bot/llm/llm-setting-ref-params`、`bot/new-list`、`bot/remove-follower`、`bot/remove-group`、`bot/send-setting-json`

**captcha**（1）  `captcha/get`

**check**（3）  `check/check-version`、`check/check-version-mobile`、`check/get-latest-version`

**coin**（4）  `coin/shop/product-detail`、`coin/shop/product-recommend`、`coin/task/my-task-info`、`coin/task/raffle`

**common**（1）  `common/get-version`

**community**（27）  `community/ba/delete`、`community/ba/follower-list`、`community/ba/forward`、`community/ba/manage-setting`、`community/ba/user-follow-ba`、`community/ba/user-unfollow-ba`、`community/black-list`、`community/c/following-ba-list`、`community/c/info`、`community/comment/comment`、`community/comment/comment-list`、`community/comment/comment-reward`、`community/posts/cancel-draft`、`community/posts/create-draft`、`community/posts/delete`、`community/posts/edit`、`community/posts/edit-sticky`、`community/posts/get-draft`、`community/posts/my-post-list`、`community/posts/post-collect`、`community/posts/post-like`、`community/posts/post-list-recommend`、`community/posts/post-reward`、`community/report`、`community/reward-record`、`community/search`、`community/set-black-list`

**conversation**（2）  `conversation/remove`、`conversation/sort-change`

**disk**（1）  `disk/rename`

**document**（2）  `document/detail`、`document/menus`

**event**（2）  `event/edit`、`event/list`

**file**（3）  `file/offer`、`file/reply`、`file/send`

**group**（15）  `group/agree-invite`、`group/category`、`group/dismiss-group`、`group/edit-auto-delete-message`、`group/edit-group-keyword`、`group/edit-shop-entry`、`group/edit-stop-member-upload-group-file`、`group/event-sse`、`group/group-info`、`group/info-add-friend`、`group/live-room`、`group/member-is-removed`、`group/recommend/list`、`group/remove-bot`、`group/switch`

**live**（7）  `live/add`、`live/close`、`live/get-calling`、`live/hang`、`live/room-info`、`live/stream-info`、`live/title-edit`

**menu**（1）  `menu/event`

**misc**（7）  `misc/auto-update`、`misc/gray-status`、`misc/qiniu-token-audio`、`misc/qiniu-token-group-disk`、`misc/qiniu-token-video`、`misc/setting`、`misc/updates`

**msg**（5）  `msg/delete`、`msg/file-download-record`、`msg/list-message-by-mid-seq`、`msg/list-message-by-seq`、`msg/pic-list-message-by-mid-seq`

**report**（1）  `report/create`

**rss**（2）  `rss/recommend-apply`、`rss/recommend-list`

**search**（1）  `search/home-search`

**share**（2）  `share/create`、`share/info`

**sticker**（2）  `sticker/add`、`sticker/sort`

**sticky**（4）  `sticky/add`、`sticky/delete`、`sticky/list`、`sticky/topping`

**user**（23）  `user/bing-email`、`user/bing-phone`、`user/cancel-user`、`user/captcha`、`user/change-email-check`、`user/change-phone-check`、`user/device-offline`、`user/forget-password`、`user/get-token`、`user/get-user-show-adv`、`user/gold-coin-increase-decrease-record`、`user/homepage`、`user/logout`、`user/medal`、`user/module-ignore`、`user/module-ignore-info`、`user/notification-info`、`user/notification-status`、`user/recommend`、`user/recommend-category-list`、`user/recommend-list`、`user/save-user-remarks`、`user/verification-login`

**verification**（2）  `verification/get-email-verification-code`、`verification/get-verification-code`

**vip**（2）  `vip/vip-benefits-list`、`vip/vip-product-list`
