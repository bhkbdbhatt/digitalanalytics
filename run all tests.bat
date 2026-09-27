set path=C:\Program Files\nodejs;%path%
npm config set registry https://cgrepo.capgroup.com/repository/cgnpm
npm config set no-proxy https://cgrepo.capgroup.com
npm config set strict-ssl false
npm config set sass_binary_site https://cgrepo.capgroup.com/repository/cgfiles/node-sass
npm install
npm test