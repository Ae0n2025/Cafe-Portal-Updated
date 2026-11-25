# Café Portal

Café Portal is a web application for STI College Global City. 



Less wait, Less Hastle.

## Open on another device on your network

1. Start the app on this computer with `npm run dev`.
2. Find this computer's IPv4 address: on Windows, run `ipconfig` and use the IPv4 address for the Wi-Fi or Ethernet adapter connected to your network.
3. On the other device, connected to the same network, open `http://<computer-ip>:3000` (replace `<computer-ip>` with that IPv4 address).
4. If Windows Firewall prompts you, allow Node.js on private networks. If the page does not load, allow inbound TCP port 3000 on the private network and check that both devices are on the same network.

For a production server, build with `npm run build`, then run `npm start`; it also listens on the network interface.