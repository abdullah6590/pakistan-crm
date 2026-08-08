const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const dirToSearch = path.join(__dirname, 'src', 'app', 'dashboard');

walkDir(dirToSearch, function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    const original = content;
    content = content.replace(/"Product added"/g, '"Component added"');
    content = content.replace(/"Product updated"/g, '"Component updated"');
    content = content.replace(/"Product deleted"/g, '"Component deleted"');
    content = content.replace(/"Edit Product"/g, '"Edit Component"');
    content = content.replace(/"Add Product"/g, '"Add Component"');
    content = content.replace(/"Delete Product"/g, '"Delete Component"');
    content = content.replace(/"No products found"/g, '"No components found"');
    
    // UI JSX strings
    content = content.replace(/>Product</g, '>Component<');
    content = content.replace(/Add Product/g, 'Add Component');
    content = content.replace(/paper products/g, 'electronic components');
    content = content.replace(/Search product/ig, 'Search component');
    content = content.replace(/Select Product/ig, 'Select Component');
    content = content.replace(/Select a product/ig, 'Select a component');
    content = content.replace(/Product Name/ig, 'Component Name');
    
    if (original !== content) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Reverted: ' + filePath);
    }
  }
});
console.log('Revert UI Done.');
