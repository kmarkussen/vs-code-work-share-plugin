# Work Share

A VS Code extension that provides visibility to teams on which project files are being worked on and by whom.

## Features

- **File Activity Tracking**: Monitors which files are being edited and by whom
- **Real-time Updates**: Provides live updates on file activity across your team
- **User Identification**: Automatically identifies users based on git configuration or custom settings
- **External API Integration**: Reports file activity to external systems for team-wide visibility
- **Activity View**: Displays current file activity in a dedicated sidebar view

## Requirements

- Visual Studio Code 1.85.0 or higher
- Git (for automatic user identification)

## Extension Settings

This extension contributes the following settings:

- `workShare.apiServerUrl`: API server URL for reporting file activity
- `workShare.userName`: User name for identification (leave empty to use git config)
- `workShare.enabled`: Enable/disable file activity tracking
- `workShare.updateInterval`: Interval (in milliseconds) for checking file activity (default: 5000ms)

## Usage

1. Install the extension
2. Configure the API server URL in settings (optional)
3. The extension will automatically start tracking file activity
4. View activity in the "Work Share" sidebar panel
5. Use commands:
    - `Work Share: Show File Activity` - Display file activity view
    - `Work Share: Configure Settings` - Open extension settings

## Development

### Setup

```bash
npm install
```

### Compile

```bash
npm run compile
```

### Watch mode

```bash
npm run watch
```

### Run Extension

Press F5 to open a new window with your extension loaded.

## Release Notes

### 0.0.1

Initial release of Work Share extension

- File activity tracking
- Real-time updates
- API integration for team visibility
- Activity tree view

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
