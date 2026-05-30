---
title: Descargar SkylerX
description: Instaladores para todas las plataformas (macOS / Windows / Linux), arquitectura x64 + arm64
---

# Descargar SkylerX

<DownloadButton />

::: tip Selección automática de origen
Los accesos desde China continental, Hong Kong y Macao usan automáticamente el **espejo Aliyun OSS** (nodo de Shanghái) por enlace directo, mucho más rápido que GitHub; los usuarios fuera de China usan **GitHub Releases**. Puedes cambiar manualmente desde el selector superior de la matriz y recordar tu elección.
:::

<DownloadMatrix />

## Requisitos del sistema

| Plataforma | Versión mínima | Recomendada |
|---|---|---|
| **macOS** | 10.13 (High Sierra) | 12+ (Monterey o superior) |
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+ (Ubuntu 20.04 / Debian 11 / CentOS 8 o equivalentes) | Ubuntu 22.04+ |

**Arquitecturas**: soporte dual para x64 (Intel / AMD) y arm64 (Apple Silicon / servidores ARM / Surface Pro X).

## Entornos 国产信创 (bases de datos chinas)

Compatible con los siguientes sistemas operativos chinos (usa `.deb` / `.rpm` / `.AppImage`):

| Sistema | Formato recomendado |
|---|---|
| **银河麒麟 / Kylin** / **中标麒麟 / NeoKylin** | `.rpm` |
| **统信 UOS / UnionTech UOS** | `.deb` |
| **Ubuntu Kylin** / **优麒麟** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **Red Flag Linux** | `.rpm` |
| **Loongson LoongArch** | Sin build oficial; contacta para una compilación empresarial a medida |

## Actualizaciones

SkylerX incluye **actualización automática** (basada en electron-updater). Al abrir la app, detecta nuevas versiones y te pide descargarlas.

Para desactivarla, ve a `Settings → Actualizaciones` y desactiva "Buscar actualizaciones automáticamente".

::: warning Usuarios de Windows — actualizar de v0.5.0-rc1 / rc2 a rc3+ requiere una intervención manual única
Las versiones antiguas (rc1/rc2) del updater validaban estrictamente `publisherName`; desde v0.5.0-rc3 se ha desactivado temporalmente la verificación de firma (esperando aprobación de SignPath Foundation), por lo que la auto-actualización lanza el error `not signed by the application owner`.

**Operación manual única**: descarga el setup.exe o portable.exe rc3+ correspondiente desde la tabla inferior y reinstala encima (no perderás la configuración). A partir de ahí, la actualización automática volverá a funcionar.

Cuando SignPath Foundation apruebe la solicitud, se restaurará la firma EV con verificación estricta y no harán falta más pasos manuales.
:::

## Versiones anteriores

[Ver todas las versiones en GitHub Releases →](https://github.com/duhbbx/SkylerX/releases)

## Firma de código / Code Signing

Los instaladores de Windows están firmados digitalmente a través de **[SignPath Foundation](https://signpath.org/)**, una organización sin fines de lucro que ofrece firma de código gratuita a proyectos open source.

> Code signing for this project is provided by the [SignPath Foundation](https://signpath.org/), free of charge.

This means:
- Windows users won't see SmartScreen "unknown publisher" warnings
- The installer's authenticity can be verified through standard certificate chain checks
- `electron-updater` enforces publisher name matching on every update

The Foundation issues an EV (Extended Validation) code-signing certificate to qualifying open-source projects. SkylerX is grateful for their support of the open-source community.

## Verificar el instalador

Cada Release incluye `SHA256SUMS.txt`. Después de descargar, verifica el hash:

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# o compara con el valor de SHA256SUMS.txt en la página de Releases

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## ¿Tienes problemas?

- **GitHub lento en China**: esta página cambia automáticamente al espejo Aliyun OSS (selector superior); o usa aceleradores como `https://github.akams.cn/` reemplazando el prefijo de la URL de GitHub
- **Espejo OSS lento o descarga interrumpida**: pulsa "🌐 GitHub" en el selector superior para volver al origen, o entra directamente en <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> y usa un gestor de descargas (IDM / Aria2, etc.) que soporte reanudación
- **Falla la instalación**: consulta la [guía de resolución de problemas →](/es/docs/troubleshooting)
- **macOS muestra "no se puede verificar el desarrollador"**: clic derecho en la app → Abrir → confirma; o en `Ajustes del sistema → Privacidad y seguridad` pulsa "Abrir de todos modos"

## Licencia

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — el cliente de escritorio es totalmente open source y de uso comercial gratuito.
