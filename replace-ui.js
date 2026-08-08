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
  if (filePath.endsWith('-client.tsx')) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    const original = content;
    content = content.replace(/"Component added"/g, '"Product added"');
    content = content.replace(/"Component updated"/g, '"Product updated"');
    content = content.replace(/"Component deleted"/g, '"Product deleted"');
    content = content.replace(/"Edit Component"/g, '"Edit Product"');
    content = content.replace(/"Add Component"/g, '"Add Product"');
    content = content.replace(/"Delete Component"/g, '"Delete Product"');
    content = content.replace(/"No components found"/g, '"No products found"');
    
    // UI JSX strings
    content = content.replace(/>Component</g, '>Product<');
    content = content.replace(/Add Component/g, 'Add Product');
    content = content.replace(/electronic components/g, 'paper products');
    content = content.replace(/Search component/ig, 'Search product');
    content = content.replace(/Select Component/ig, 'Select Product');
    content = content.replace(/Select a component/ig, 'Select a product');
    content = content.replace(/Component Name/ig, 'Product Name');
    
    if (original !== content) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated: ' + filePath);
    }
  }
});
console.log('Done.');
