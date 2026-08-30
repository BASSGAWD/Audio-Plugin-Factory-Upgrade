#define BuildDir GetEnv("ORANGEJUCE_BUILD_DIR")
#define OutputDir GetEnv("ORANGEJUCE_OUTPUT_DIR")
#define ReleaseVersion GetEnv("ORANGEJUCE_RELEASE_VERSION")

[Setup]
AppId={{8E0E4F23-B2F5-4CE7-AE37-EA754440870A}
AppName=OrangeJUCE Studio
AppVersion={#ReleaseVersion}
AppPublisher=ORANGEJUCE
DefaultDirName={autopf}\OrangeJUCE Studio
DefaultGroupName=OrangeJUCE Studio
OutputDir={#OutputDir}
OutputBaseFilename=OrangeJUCE-Studio-{#ReleaseVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\OrangeJUCE Studio.exe
WizardStyle=modern

[Files]
Source: "{#BuildDir}\OrangeJUCE Studio.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\OrangeJUCE Studio"; Filename: "{app}\OrangeJUCE Studio.exe"
Name: "{autodesktop}\OrangeJUCE Studio"; Filename: "{app}\OrangeJUCE Studio.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\OrangeJUCE Studio.exe"; Description: "Launch OrangeJUCE Studio"; Flags: nowait postinstall skipifsilent