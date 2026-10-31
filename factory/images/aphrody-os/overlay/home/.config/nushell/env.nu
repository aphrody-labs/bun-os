$env.PATH = ($env.PATH | split row (char esep) | prepend [/usr/local/bin] | uniq)
