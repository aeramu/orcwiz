use std::env;
use std::fs;
use std::path::PathBuf;

pub fn install_service() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let exe_path = env::current_exe()?;
    let exe_path_str = exe_path.to_string_lossy();
    
    #[cfg(target_os = "macos")]
    {
        println!("Installing launchd service on macOS...");
        let label = "com.orcwiz.daemon";
        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>"#,
            label, exe_path_str
        );

        let user_dirs = directories::UserDirs::new().expect("Failed to get user dirs");
        let launch_agents_dir = user_dirs.home_dir().join("Library/LaunchAgents");
        fs::create_dir_all(&launch_agents_dir)?;
        
        let plist_path = launch_agents_dir.join(format!("{}.plist", label));
        fs::write(&plist_path, plist_content)?;
        
        println!("Service installed to {:?}", plist_path);
        println!("To start it, run: launchctl load {:?}", plist_path);
    }

    #[cfg(target_os = "windows")]
    {
        println!("Installing service on Windows...");
        println!("You can use 'sc' to create a Windows Service.");
        println!("Run this command as Administrator:");
        println!("sc create Orcwiz binPath= \"{} start\" start= auto", exe_path_str);
    }

    #[cfg(target_os = "linux")]
    {
        println!("Installing systemd service on Linux...");
        let service_content = format!(
            r#"[Unit]
Description=Orcwiz AI Agent Orchestration Tool
After=network.target

[Service]
Type=simple
ExecStart={} start
Restart=on-failure

[Install]
WantedBy=multi-user.target
"#,
            exe_path_str
        );

        let service_path = PathBuf::from("/etc/systemd/system/orcwiz.service");
        // Note: This requires root
        if let Err(e) = fs::write(&service_path, service_content) {
            println!("Failed to write to {:?}. Did you run as root/sudo? Error: {}", service_path, e);
        } else {
            println!("Service installed to {:?}", service_path);
            println!("Run 'sudo systemctl daemon-reload' and 'sudo systemctl enable --now orcwiz'");
        }
    }

    Ok(())
}
