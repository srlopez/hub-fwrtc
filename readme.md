# HUB IKUZAIN 

## Instalación

 ```bash
sudo apt install nodejs npm
sudo cp ikuzain.service /etc/systemd/system
sudo systemctl enable ikuzain
sudo systemctl start ikuzain


journalctl -u ikuzain -f
 
```