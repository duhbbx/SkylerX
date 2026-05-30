# Instalación y actualización

## macOS

Descarga el `.dmg` → doble clic para montarlo → arrastra SkylerX a Applications → expulsa el disco.

En el primer arranque puede aparecer "no se puede verificar el desarrollador":
1. Clic derecho en SkylerX → Abrir → en el diálogo pulsa "Abrir"
2. O en `Ajustes del sistema → Privacidad y seguridad → Abrir de todos modos`

### Apple Silicon vs Intel

La página de descargas detecta automáticamente y recomienda la versión arm64. Si tu Mac tiene Rosetta también funciona el x64, pero arm64 es nativo y resulta más rápido y con menor consumo de memoria.

## Windows

Descarga el asistente `.exe` → doble clic → pulsa Next hasta el final.

**Aviso de SmartScreen**: pulsa "Más información → Ejecutar de todos modos".

### x64 vs arm64

x64 funciona en cualquier PC con Windows; arm64 está pensado para Surface Pro X / portátiles con Qualcomm Snapdragon y evita el consumo de batería extra de la emulación x64.

## Linux

### AppImage (sin instalación, ideal para uso puntual)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb (Debian / Ubuntu / UnionTech UOS / Ubuntu Kylin / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# Si hay problemas de dependencias:
sudo apt-get install -f
```

### .rpm (Fedora / openEuler / Kylin / Red Flag / NeoKylin)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# o con dnf
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman (Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz (otras distribuciones)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# Opcional: crea un acceso directo en el escritorio
```

## Actualización automática

SkylerX incluye `electron-updater`; tras el arranque comprueba versiones nuevas:

1. Descarga silenciosa en segundo plano
2. Cuando termina avisa "Reinicia la app para completar la actualización"
3. Al pulsar se aplica la nueva versión

**Desactivar la auto-actualización**: `Settings → Actualizaciones → desmarca "Buscar actualizaciones automáticamente"`, o inicia con la variable de entorno `SKYLERX_DISABLE_AUTOUPDATE=1`.

## Ubicación de los datos

La base de configuración local (SQLite) de SkylerX se guarda en el directorio estándar de datos de usuario del SO:

| Plataforma | Ruta |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

Contiene:
- Conexiones (contraseñas cifradas con el llavero del SO)
- Historial de consultas SQL
- Biblioteca de snippets SQL
- Favoritos
- Memoria de la IA
- Preferencias del usuario

**Recomendación de backup**: copia regularmente el directorio completo `@db-tool/desktop` a OneDrive / iCloud / NAS.

## Desinstalación

### macOS
Arrastra SkylerX a la papelera → opcionalmente limpia `~/Library/Application Support/@db-tool/`

### Windows
Panel de control → Programas y características → SkylerX → Desinstalar → opcionalmente limpia `%APPDATA%\@db-tool\`

### Linux
```bash
sudo apt remove skylerx        # instalación .deb
sudo rpm -e skylerx            # instalación .rpm
rm -f ~/.config/@db-tool       # configuración (opcional)
```

## Actualizar

La auto-actualización dentro de la app es suficiente; reinicia y listo. También puedes descargar manualmente el nuevo instalador y reinstalar encima. **La base de configuración se conserva** y es compatible entre versiones.

## Entornos chinos 信创

Compatible con los siguientes SO chinos:

- **Kylin / NeoKylin**: se recomienda `.rpm`
- **UnionTech UOS**: se recomienda `.deb`
- **Ubuntu Kylin**: se recomienda `.deb`
- **openEuler**: se recomienda `.rpm`
- **Deepin**: se recomienda `.deb`

**Loongson LoongArch / Phytium**: aún no hay build oficial; si lo necesitas, contáctanos para [colaboración empresarial](mailto:duhbbx@gmail.com) y compilación a medida.
