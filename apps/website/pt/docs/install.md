# Instalação e atualização

## macOS

Baixe o `.dmg` → duplo clique para montar → arraste o SkylerX para Applications → ejete o disco.

A primeira inicialização pode mostrar "não foi possível verificar o desenvolvedor":
1. Clique com botão direito em SkylerX → Abrir → escolha "Abrir" no popup
2. Ou `Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim`

### Apple Silicon vs Intel

A página de download detecta automaticamente e recomenda a versão arm64. Se o seu Mac tem Rosetta, a versão x64 também funciona, mas a arm64 nativa é mais rápida e consome menos memória.

## Windows

Baixe o assistente `.exe` → duplo clique → clique em Next até o fim.

**Aviso do SmartScreen**: clique em "Mais informações → Executar mesmo assim".

### x64 vs arm64

x64 é compatível com todas as máquinas Windows; arm64 é para Surface Pro X / notebooks Snapdragon, evita o consumo extra de bateria da emulação x64.

## Linux

### AppImage (sem instalação, ideal para uso temporário)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb (Debian / Ubuntu / 统信 UOS / 优麒麟 / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# Em caso de dependências faltando:
sudo apt-get install -f
```

### .rpm (Fedora / openEuler / 银河麒麟 / 红旗 / 中标麒麟)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# Ou com dnf
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman (Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz (outras distribuições)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# Opcional: criar atalho na área de trabalho
```

## Atualização automática

O SkylerX vem com `electron-updater`. Após iniciar, ele checa novas versões:

1. Download silencioso em segundo plano
2. Ao concluir, exibe "Reinicie a aplicação para finalizar a atualização"
3. O usuário clica e a nova versão é aplicada

**Desativar atualização automática**: `Settings → Atualização → desmarcar "verificar atualizações automaticamente"` ou iniciar com a variável `SKYLERX_DISABLE_AUTOUPDATE=1`.

## Local de armazenamento dos dados

O banco de configuração local (SQLite) do SkylerX fica no diretório padrão do usuário:

| Plataforma | Caminho |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

Contém:
- Configurações de conexão (senhas criptografadas via chaveiro do SO)
- Histórico de consultas SQL
- Biblioteca de snippets SQL
- Favoritos
- Memória da IA
- Preferências do usuário

**Recomendação de backup**: copie regularmente o diretório `@db-tool/desktop` para OneDrive / iCloud / NAS.

## Desinstalação

### macOS
Arraste SkylerX para a Lixeira → opcionalmente limpe `~/Library/Application Support/@db-tool/`

### Windows
Painel de Controle → Programas e Recursos → SkylerX → Desinstalar → opcionalmente limpe `%APPDATA%\@db-tool\`

### Linux
```bash
sudo apt remove skylerx        # se instalado via .deb
sudo rpm -e skylerx            # se instalado via .rpm
rm -f ~/.config/@db-tool       # config (opcional)
```

## Atualização

Atualização automática dentro da app → reinicie. Você também pode baixar manualmente o novo instalador e sobrescrever. **O banco de configuração não é perdido** e é compatível entre versões.

## Ambiente 信创 (nacional chinês)

Compatível com os seguintes sistemas operacionais chineses:

- **银河麒麟 / 中标麒麟**: recomendado `.rpm`
- **统信 UOS**: recomendado `.deb`
- **Ubuntu Kylin 优麒麟**: recomendado `.deb`
- **openEuler**: recomendado `.rpm`
- **Deepin**: recomendado `.deb`

**龙芯 LoongArch / 飞腾**: sem compilação oficial; em caso de necessidade, [entre em contato com parcerias corporativas](mailto:duhbbx@gmail.com) para compilação customizada.
