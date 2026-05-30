---
title: Baixar SkylerX
description: Instaladores para todas as plataformas (macOS / Windows / Linux), com suporte a múltiplas arquiteturas x64 + arm64
---

# Baixar SkylerX

<DownloadButton />

::: tip Seleção automática da fonte de download
Acessos da China continental / Hong Kong / Macau usam automaticamente o **espelho Alibaba Cloud OSS** (nó de Xangai) por link direto, bem mais rápido que GitHub; usuários no exterior usam o **GitHub Releases**. O seletor no topo da matriz permite trocar manualmente e lembra a sua escolha.
:::

<DownloadMatrix />

## Requisitos de sistema

| Plataforma | Versão mínima | Recomendado |
|---|---|---|
| **macOS** | 10.13 (High Sierra) | 12+ (Monterey ou superior) |
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+ (Ubuntu 20.04 / Debian 11 / CentOS 8 ou similar) | Ubuntu 22.04+ |

**Arquiteturas**: suporte dual a x64 (Intel / AMD) e arm64 (Apple Silicon / servidores ARM / Surface Pro X).

## Ambiente 信创 (nacional chinês)

Compatível com os seguintes sistemas operacionais chineses (use `.deb` / `.rpm` / `.AppImage`):

| Sistema | Formato recomendado |
|---|---|
| **银河麒麟** / **中标麒麟** | `.rpm` |
| **统信 UOS** | `.deb` |
| **Ubuntu Kylin** / **优麒麟** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **红旗 Linux** | `.rpm` |
| **龙芯 LoongArch** | Sem compilação oficial; entre em contato para compilação corporativa |

## Atualização

O SkylerX tem **atualização automática integrada** (baseada em electron-updater). Após abrir a aplicação, ele detecta automaticamente novas versões e oferece a instalação.

Para desativar, vá em `Settings → Atualização` e desmarque "verificar atualizações automaticamente".

::: warning Usuários Windows — atualizar de v0.5.0-rc1 / rc2 para rc3+ exige uma etapa manual única
Versões antigas (rc1/rc2) do updater validavam rigorosamente o `publisherName`, mas a partir de v0.5.0-rc3 a validação de assinatura foi temporariamente removida (aguardando aprovação da SignPath Foundation), causando o erro `not signed by the application owner` na atualização automática.

**Passo manual único**: baixe o setup.exe ou portable.exe rc3+ correspondente à sua plataforma na tabela abaixo e instale por cima (a configuração não será perdida). A partir daí, a atualização automática volta ao normal.

Após a aprovação da SignPath Foundation, a assinatura EV + validação rigorosa serão restauradas e nenhum passo manual será mais necessário.
:::

## Versões anteriores

[Ver todas as versões no GitHub Releases →](https://github.com/duhbbx/SkylerX/releases)

## Assinatura de código / Code Signing

Os instaladores Windows são assinados digitalmente pela **[SignPath Foundation](https://signpath.org/)** — uma organização sem fins lucrativos que oferece assinatura de código gratuita para projetos open source.

> Code signing for this project is provided by the [SignPath Foundation](https://signpath.org/), free of charge.

This means:
- Windows users won't see SmartScreen "unknown publisher" warnings
- The installer's authenticity can be verified through standard certificate chain checks
- `electron-updater` enforces publisher name matching on every update

The Foundation issues an EV (Extended Validation) code-signing certificate to qualifying open-source projects. SkylerX is grateful for their support of the open-source community.

## Verificar o instalador

Cada Release inclui `SHA256SUMS.txt`. Após o download, verifique:

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# ou compare com o valor em SHA256SUMS.txt na página de Releases

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## Com problemas?

- **GitHub lento na China**: esta página alterna automaticamente para o espelho Alibaba Cloud OSS (seletor no topo); ou use prefixos de aceleração como `https://github.akams.cn/` para substituir o URL do GitHub
- **Espelho OSS também lento / download interrompido**: clique em "🌐 GitHub" no topo para voltar à fonte original, ou acesse diretamente <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> e use uma ferramenta de download (IDM / Aria2 etc.) com retomada
- **Falha na instalação**: veja [a documentação de troubleshooting →](/pt/docs/troubleshooting)
- **macOS exibe "não foi possível verificar o desenvolvedor"**: clique com o botão direito na aplicação → Abrir → confirme abrir; ou em `Ajustes do Sistema → Privacidade e Segurança`, clique em "Abrir mesmo assim"

## Licença

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — o desktop é totalmente open source, uso comercial gratuito.
