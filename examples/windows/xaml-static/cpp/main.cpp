// Prints "<path>\t<root element>\t<element count>" for every XAML file listed (one path per line) in argv[1].
#include <fcntl.h>
#include <io.h>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

static void scan(const std::string& t, std::string& root, size_t& count) {
    size_t i = 0;
    count = 0;
    while ((i = t.find('<', i)) != std::string::npos) {
        if (t.compare(i, 4, "<!--") == 0) { auto e = t.find("-->", i + 4); i = e == std::string::npos ? t.size() : e + 3; continue; }
        if (t.compare(i, 9, "<![CDATA[") == 0) { auto e = t.find("]]>", i); i = e == std::string::npos ? t.size() : e + 3; continue; }
        if (t.compare(i, 2, "<?") == 0) { auto e = t.find("?>", i); i = e == std::string::npos ? t.size() : e + 2; continue; }
        unsigned char c = i + 1 < t.size() ? t[i + 1] : 0;
        if (std::isalpha(c) || c == '_') {
            size_t j = i + 1;
            while (j < t.size() && !std::strchr(" \t\r\n/>", t[j])) j++;
            if (root.empty()) root = t.substr(i + 1, j - i - 1);
            count++;
            i = j;
        } else i++;
    }
}

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    _setmode(_fileno(stdout), _O_BINARY);
    std::ifstream list(argv[1]);
    std::string path;
    while (std::getline(list, path)) {
        if (!path.empty() && path.back() == '\r') path.pop_back();
        if (path.empty()) continue;
        std::ifstream f(path, std::ios::binary);
        std::stringstream ss;
        ss << f.rdbuf();
        std::string text = ss.str();
        if (text.compare(0, 3, "\xEF\xBB\xBF") == 0) text.erase(0, 3);
        std::string root;
        size_t count;
        scan(text, root, count);
        std::printf("%s\t%s\t%zu\n", path.c_str(), root.c_str(), count);
    }
    return 0;
}
