# dsh-purge-unslopped

极简 DeepSeek Harness 破甲插件。

## 安装

1. 将仓库 clone 到任意位置：

   ```bash
   git clone https://github.com/Ujhhgtg/dsh-purge-unslopped.git ~/dsh-purge
   ```

2. 找到 web profile 的 `package.json`，通常位于：

   ```text
   ~/.dsh/profiles/web/package.json
   ```

3. 修改 `package.json`，添加以下配置：

    ```diff
     {
       "name": "dsh-profile-web",
       "private": true,
       "dsh": {
         "profile": {
           "bundles": [
             "@deepseek-ai/dsh-base",
             "@deepseek-ai/dsh-web-app",
    +        "@local/dsh-purge"
           ]
         }
       },
       "dependencies": {
    +    "@local/dsh-purge": "link:/home/user/dsh-purge"
       }
     }
    ```

   注意：将 `link:/home/user/dsh-purge` 替换为仓库实际所在的绝对路径。

4. 运行以下命令，让 `dsh` 刷新 pnpm lock：

   ```bash
   dsh plugin --profile web install
   ```

5. 重启 `dsh`。

## 来源

上游 [luowang-ui/dsh-purge-plus](https://github.com/luowang-ui/dsh-purge-plus) 的勾石代码给我看死了，因此进行了精简：只保留运行时注入，移除面板、CLI、演练台、规则集、技能管理、自更新及宿主补丁等功能。
