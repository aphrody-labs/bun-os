#include <stdio.h>

int main(void) {
  printf("bunos-c hello %d-bit\n", (int)(sizeof(void *) * 8));
  return 0;
}
