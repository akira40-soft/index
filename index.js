// ===============================
// QRCode compacto e sólido (Render-safe)
// ===============================
import qrcodeGenerator from 'qrcode-generator';

function exibirQRCode(qrData) {
  console.clear();
  console.log('==============================');
  console.log('📱 ESCANEIE O QR ABAIXO PARA CONECTAR:\n');

  // Cria o QR
  const qr = qrcodeGenerator(0, 'L');
  qr.addData(qrData);
  qr.make();

  // Modo denso — usa blocos ▓█ sem espaçamento extra
  const qrText = qr.createString(2)
    .replace(/0/g, '  ')     // espaço duplo = branco
    .replace(/1/g, '██');    // bloco cheio = preto

  // Remove margens vazias
  const lines = qrText
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.trimEnd());

  // Fundo sólido e contraste total
  console.log('\x1b[40m\x1b[37m'); // fundo preto, texto branco
  console.log(lines.join('\n'));
  console.log('\x1b[0m');
  console.log('==============================');
}
